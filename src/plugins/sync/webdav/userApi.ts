import { getUserApiList, getUserApiScript } from '@/utils/data'
import { getData, saveData, saveDataMultiple, removeDataMultiple } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { log } from './logger'
import { stringMd5 } from 'react-native-quick-md5'

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
// ⚠️ 关键约定：lx 的自定义音源 id 必须以 `user_api_` 前缀开头，
//    setApiSource 通过 /^user_api/.test(id) 判断是否为自定义源；
//    若没有此前缀，激活时会走 else 分支（destroyUserApi + qualityList={}），
//    音源永远不会被加载，播放时就会一直「换源失败」。
//    本地 addUserApi() 生成的 id 自带前缀，但远端文件名为了可读去掉了前缀，
//    因此 WebDAV 层必须在「远端裸 id ↔ 本地前缀 id」之间做转换：
//      - 远端文件名（与 meta.id）：裸 id（如 野花v1）
//      - 本地 storage id / 列表 id：前缀 id（如 user_api_野花v1）
//    旧版本（无前缀）同步下来的残留数据会在此处被迁移并清理。
// ============================================================================

const USER_API_PREFIX = storageDataPrefix.userApi

/** lx 自定义音源 id 必须带此前缀，否则 setApiSource 不会把它当作 user_api 加载 */
const USER_API_ID_PREFIX = 'user_api_'

/** 本地 id：必须带 user_api_ 前缀（与 utils/data 的 addUserApi 一致） */
const normalizeLocalId = (raw: string): string =>
  raw.startsWith(USER_API_ID_PREFIX) ? raw : `${USER_API_ID_PREFIX}${raw}`

/** 远端文件名用的 id（去掉前缀，仅用于文件名，便于阅读） */
const toRemoteId = (localId: string): string =>
  localId.startsWith(USER_API_ID_PREFIX) ? localId.slice(USER_API_ID_PREFIX.length) : localId

/** 远端目录名（与 list / dislike 区分） */
export const USER_API_DIR = 'music-source'
/** 远端元信息文件名 */
export const USER_API_META_FILE = 'meta.json'

/** 脚本文件扩展名 */
const SCRIPT_EXT = '.js'

/** 单个远端音源文件的内容 */
export interface RemoteUserApiItem {
  /** 远端裸 id（即文件名去掉扩展名，如 野花v1）；本地来源时即本地 id */
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

/** 本地 id（可带前缀）→ 远端文件名（不带前缀） */
const toFileName = (id: string): string => `${toRemoteId(id)}${SCRIPT_EXT}`
/** 远端文件名 → 远端裸 id（不含扩展名） */
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
  /** 因删除同步而移除的数量（远端删除 -> 本地删除，或本地删除 -> 不再同步回来） */
  removed: number
}

/** 已通过同步“建立关系”的音源 id 集合（规范化后的本地前缀 id）。
 *  只有在此集合中的音源，才会因远端删除而一并从本地删除；
 *  纯本地手动导入、从未参与同步的音源永远保留。 */
const USER_API_SYNCED_KEY = storageDataPrefix.userApiSynced

export const getSyncedIds = async(): Promise<Set<string>> => {
  const arr = await getData<string[]>(USER_API_SYNCED_KEY)
  return new Set(Array.isArray(arr) ? arr : [])
}

export const saveSyncedIds = async(ids: Set<string>): Promise<void> => {
  await saveData(USER_API_SYNCED_KEY, [...ids])
}

/**
 * 将远端音源合并到本地（以规范化后的本地 id 为准）：
 *   - 本地缺失 → 新增（保留远端裸 id 对应的前缀 id，保证下次同步能对应上）
 *   - 本地存在且远端 version 更新 → 覆盖脚本与元信息
 *   - 否则保留本地
 * 本地独有的音源一律保留，不因同步而删除。
 *
 * 所有写入本地的 id 都会规范化为带 `user_api_` 前缀的形式，
 * 并清理旧版本（无前缀）同步遗留的 storage key，避免「换源失败」。
 */
export const mergeRemoteUserApiList = async(items: RemoteUserApiItem[]): Promise<MergeResult> => {
  const result: MergeResult = { added: 0, updated: 0, skipped: 0, removed: 0 }
  const prevSynced = await getSyncedIds()
  const newSynced = new Set(prevSynced)

  const localList = await getUserApiList()
  // 以「规范化后的本地 id」建立索引，兼容旧版本（无前缀）的残留数据
  const localMap = new Map(localList.map((info) => [normalizeLocalId(info.id), info]))
  // 额外按 name 建立索引：本地手动导入的源 id 是随机串（user_api_<rand>_<ts>），
  // 而远端裸 id 是可读名（如 野花v1），二者 id 不同但脚本同源、name 一致。
  // 按 name 匹配可把远端源合并进已有的本地同源源，避免产生重复源。
  const localNameMap = new Map(localList.map((info) => [info.name, info]))
  const toSave: Array<[string, unknown]> = []
  // 缓存本次合并已确定的脚本内容，供脚本哈希去重使用（避免去重时新源脚本尚未落盘而读到空串）
  const scripts = new Map<string, string>()
  const staleKeys: string[] = [] // 待删除的脚本 key（含旧无前缀残留）
  const newList: LX.UserApi.UserApiInfo[] = []
  const remoteLocalIds = new Set<string>()

  // 1) 处理远端音源：新增 / 更新 / 跳过；本地曾同步过但已删除的不回灌
  for (const item of items) {
    const rawId = item.id // 远端裸 id，如 野花v1
    if (!rawId || !item.script) continue
    let localId = normalizeLocalId(rawId)
    let local = localMap.get(localId)
    if (!local) {
      // id 不匹配时按 name 再匹配一次（本地已手动导入同源脚本时合并，避免重复源）
      const byName = localNameMap.get(item.info.name)
      if (byName) {
        local = byName
        localId = normalizeLocalId(byName.id)
      }
    }
    const scriptKey = `${USER_API_PREFIX}${localId}`
    remoteLocalIds.add(localId)
    if (!local) {
      // 本地已无此音源
      if (prevSynced.has(localId)) {
        // 曾经同步、但本地已删除 -> 视为删除，不重新加回本地（随后 writeRemoteUserApi 会把它从远端删掉）
        newSynced.delete(localId)
        result.removed++
        continue
      }
      // 远端新增的纯新增音源
      newList.push({ ...item.info, id: localId })
      toSave.push([scriptKey, item.script])
      scripts.set(localId, item.script)
      newSynced.add(localId)
      result.added++
    } else if (isRemoteNewer(item.info.version, local.version)) {
      if (!local.id.startsWith(USER_API_ID_PREFIX)) staleKeys.push(`${USER_API_PREFIX}${local.id}`)
      newList.push({ ...item.info, id: localId })
      toSave.push([scriptKey, item.script])
      scripts.set(localId, item.script)
      newSynced.add(localId)
      result.updated++
    } else {
      const keep: LX.UserApi.UserApiInfo = { ...local, id: localId }
      newList.push(keep)
      if (!local.id.startsWith(USER_API_ID_PREFIX)) {
        staleKeys.push(`${USER_API_PREFIX}${local.id}`)
        const oldScript = await getUserApiScript(local.id)
        toSave.push([scriptKey, oldScript])
        scripts.set(localId, oldScript)
      }
      newSynced.add(localId)
      result.skipped++
    }
  }

  // 2) 处理本地音源：远端已删除(且曾同步) -> 本地删除；纯本地手动导入 -> 保留
  for (const info of localList) {
    const localId = normalizeLocalId(info.id)
    if (remoteLocalIds.has(localId)) continue // 已在第 1 步处理
    if (prevSynced.has(localId)) {
      // 远端删除了该音源 -> 本地一并删除（清理脚本 key）
      staleKeys.push(`${USER_API_PREFIX}${localId}`)
      if (!info.id.startsWith(USER_API_ID_PREFIX)) staleKeys.push(`${USER_API_PREFIX}${info.id}`)
      newSynced.delete(localId)
      result.removed++
      continue
    }
    // 纯本地独有（从未同步）：保留，并迁移旧无前缀脚本
    const keep: LX.UserApi.UserApiInfo = { ...info, id: localId }
    newList.push(keep)
    if (!info.id.startsWith(USER_API_ID_PREFIX)) {
      staleKeys.push(`${USER_API_PREFIX}${info.id}`)
      const oldScript = await getUserApiScript(info.id)
      toSave.push([`${USER_API_PREFIX}${localId}`, oldScript])
      scripts.set(localId, oldScript)
    }
  }

  // 2.5) 折叠脚本内容完全相同的源：早期 bug 可能在本地/远端残留同源的不同 id（如
  //      user_api_野花v1 与 user_api_<rand>_<ts>），按脚本文本哈希去重，只保留其一，
  //      避免重复源随同步不断传播。脚本不同则视为不同源，绝不误删。
  const scriptCache = new Map<string, string>()
  const readScript = async(id: string): Promise<string> => {
    const key = normalizeLocalId(id)
    const cached = scriptCache.get(key)
    if (cached != null) return cached
    const s = scripts.get(key) ?? (await getUserApiScript(key)) ?? ''
    scriptCache.set(key, s)
    return s
  }
  const seenScript = new Map<string, string>() // hash -> 保留的 localId
  const dedupList: LX.UserApi.UserApiInfo[] = []
  const dupIds = new Set<string>()
  for (const info of newList) {
    const id = normalizeLocalId(info.id)
    const hash = stringMd5(await readScript(id))
    const keep = seenScript.get(hash)
    if (keep != null && keep !== id) {
      dupIds.add(id)
      newSynced.delete(id)
      result.removed++
      continue
    }
    seenScript.set(hash, id)
    dedupList.push(info)
  }
  newList.length = 0
  newList.push(...dedupList)
  for (const id of dupIds) staleKeys.push(`${USER_API_PREFIX}${id}`)

  // 3) 持久化：元信息列表 + 脚本 + 旧 key 清理 + 同步关系集合
  const changed = result.added > 0 || result.updated > 0 || result.skipped > 0 || result.removed > 0 || staleKeys.length > 0
  if (changed) {
    toSave.push([USER_API_PREFIX, newList])
    await saveDataMultiple([...new Map(toSave).entries()])
    if (staleKeys.length) await removeDataMultiple([...new Set(staleKeys)])
    await saveSyncedIds(newSynced)
    log('info', `音源合并完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}，删除 ${result.removed}；清理旧 key ${staleKeys.length}`)
  } else {
    await saveSyncedIds(newSynced)
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

/** 供上传时构建 meta 内容（id 用远端裸 id，与文件名 / fromFileName 对齐） */
export const buildUserApiMeta = (items: RemoteUserApiItem[]): RemoteUserApiMeta => ({
  version: 1,
  list: items.map((i) => ({ ...i.info, id: toRemoteId(i.info.id) })),
})

export const saveUserApiMeta = async(meta: RemoteUserApiMeta): Promise<void> => {
  // 写入本地列表的 id 必须带 user_api_ 前缀
  await saveData(USER_API_PREFIX, meta.list.map((i) => ({ ...i, id: normalizeLocalId(i.id) })))
}

export { toFileName, fromFileName, toRemoteId, normalizeLocalId }
