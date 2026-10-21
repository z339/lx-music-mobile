import { getUserApiList, getUserApiScript } from '@/utils/data'
import { getData, saveData, saveDataMultiple } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { log } from './logger'

// ============================================================================
// WebDAV 音源（自定义源）同步
//
// 远端布局：<path>/music-source/<音源id>.js
//   —— 与 list / dislike 作区分，每个音源一个独立的 .js 文件，
//      内容就是用户导入时的原始脚本文本（可被 lx 端直接导入使用）。
//      同目录下额外存放 meta.json 记录名称等元信息，便于跨端识别。
//
// 本地布局（storage）：
//   '@user_api__'        → UserApiInfo[]  元信息列表
//   '@user_api__{id}'    → 脚本文本
//
// 注意：utils/data 的 addUserApi() 每次都会生成新的随机 id，直接用它导入会导致
// 每次同步都产生重复音源，因此这里直接读写 storage 以保持 id 稳定，
// 并按 version 判断是否覆盖。
// ============================================================================

const USER_API_PREFIX = storageDataPrefix.userApi

/** 远端目录名（与 list / dislike 区分） */
export const USER_API_DIR = 'music-source'
/** 远端元信息文件名 */
export const USER_API_META_FILE = 'meta.json'

/** 脚本文件扩展名 */
const SCRIPT_EXT = '.js'

/** 单个远端音源文件的内容 */
export interface RemoteUserApiItem {
  /** 音源 id（同时作为文件名，不含扩展名） */
  id: string
  /** 音源元信息 */
  info: LX.UserApi.UserApiInfo
  /** 脚本文本 */
  script: string
}

export interface RemoteUserApiMeta {
  version: number
  list: LX.UserApi.UserApiInfo[]
}

const toFileName = (id: string): string => `${id}${SCRIPT_EXT}`
const fromFileName = (name: string): string | null => {
  if (!name.endsWith(SCRIPT_EXT)) return null
  const id = name.slice(0, -SCRIPT_EXT.length)
  return id || null
}

/** 比较版本号；无法解析时保守认为「未更新」，避免误覆盖用户本地脚本 */
const isRemoteNewer = (remote: string, local: string): boolean => {
  if (!remote || remote === local) return false
  const parse = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const a = parse(remote)
  const b = parse(local)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

/** 读取本地全部音源（含脚本），用于上传 */
export const getLocalUserApiList = async(): Promise<RemoteUserApiItem[]> => {
  const list = await getUserApiList()
  const items: RemoteUserApiItem[] = []
  for (const info of list) {
    try {
      const script = await getUserApiScript(info.id)
      if (!script) continue
      items.push({ id: info.id, info, script })
    } catch (err) {
      log('warn', `读取音源脚本失败: ${info.name}`, err)
    }
  }
  log('info', `读取到本地音源 ${items.length} 个`)
  return items
}

export interface MergeResult {
  added: number
  updated: number
  skipped: number
}

/**
 * 将远端音源合并到本地（以 id 为准）：
 *   - 本地缺失 → 新增（保留远端 id，保证下次同步能对应上）
 *   - 本地存在且远端 version 更新 → 覆盖脚本与元信息
 *   - 否则保留本地
 * 本地独有的音源一律保留，不因同步而删除。
 */
export const mergeRemoteUserApiList = async(items: RemoteUserApiItem[]): Promise<MergeResult> => {
  const result: MergeResult = { added: 0, updated: 0, skipped: 0 }
  if (!items.length) {
    log('info', '远端无音源数据')
    return result
  }

  const localList = await getUserApiList()
  const localMap = new Map(localList.map((info) => [info.id, info]))
  const toSave: Array<[string, unknown]> = []
  const newList: LX.UserApi.UserApiInfo[] = []

  for (const item of items) {
    const { id, info, script } = item
    if (!id || !info || !script) continue
    const local = localMap.get(id)
    if (!local) {
      newList.push(info)
      toSave.push([`${USER_API_PREFIX}${id}`, script])
      result.added++
    } else if (isRemoteNewer(info.version, local.version)) {
      newList.push(info)
      toSave.push([`${USER_API_PREFIX}${id}`, script])
      result.updated++
    } else {
      newList.push(local)
      result.skipped++
    }
  }

  // 保留本地独有、远端没有的音源
  for (const info of localList) {
    if (!items.some((item) => item.id === info.id)) newList.push(info)
  }

  if (result.added || result.updated) {
    toSave.push([USER_API_PREFIX, newList])
    await saveDataMultiple(toSave)
    log('info', `音源合并完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`)
  } else {
    log('info', '音源无需变更')
  }
  return result
}

/** 解析远端 meta.json（容错：字段缺失时返回空列表） */
export const parseUserApiMeta = (data: unknown): RemoteUserApiMeta => {
  if (!data || typeof data != 'object') return { version: 1, list: [] }
  const obj = data as Partial<RemoteUserApiMeta>
  return {
    version: obj.version ?? 1,
    list: Array.isArray(obj.list) ? obj.list.filter((i) => !!i?.id) : [],
  }
}

/** 供调试/测试读取原始 storage */
export const readRawUserApi = async<T = unknown>(key: string): Promise<T | null> => getData<T>(key)

/** 供上传时构建 meta 内容 */
export const buildUserApiMeta = (items: RemoteUserApiItem[]): RemoteUserApiMeta => ({
  version: 1,
  list: items.map((i) => i.info),
})

export const saveUserApiMeta = async(meta: RemoteUserApiMeta): Promise<void> => {
  await saveData(USER_API_PREFIX, meta.list)
}

export { toFileName, fromFileName }