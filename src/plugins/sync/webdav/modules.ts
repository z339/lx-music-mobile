import { is404Error, type WebDAV } from './webdav'
import { CONSTANTS, decodeData, encodeData, getDeviceId } from './shared'
import { getLocalListData, setLocalListData } from '@/plugins/sync/listEvent'
import { getLocalDislikeData, setLocalDislikeData } from '@/plugins/sync/dislikeEvent'
import { getUserApiList, parseUserApiScriptInfo } from '@/utils/data'
import {
  toRemoteListData,
  fromRemoteListData,
  getListDataMD5,
  getDislikeRulesMD5,
  type RemoteListDataFull,
  type SnapshotInfo,
} from './types'
import { SnapshotDataManage, type Options } from './snapshotDataManage'
import {
  mergeFullData,
  mergeFullDataFromSnapshot,
  mergeDislikeFullData,
  mergeDislikeFullDataFromSnapshot,
} from './merge'
import settingState from '@/store/setting/state'
import { setApiSource } from '@/core/apiSource'
import { log } from './logger'
import { stringMd5 } from 'react-native-quick-md5'
import {
  getLocalUserApiList,
  mergeRemoteUserApiList,
  saveSyncedIds,
  buildUserApiMeta,
  parseUserApiMeta,
  toFileName,
  fromFileName,
  toRemoteId,
  normalizeLocalId,
  USER_API_DIR,
  USER_API_META_FILE,
  type RemoteUserApiItem,
} from './userApi'

// ----------------------------------------------------------------------------
// 歌单同步（与 any-listen 的 webdav/modules/list.ts + shared/list/index.ts 对齐）
// ----------------------------------------------------------------------------

const checkListDirs = async(webDAV: WebDAV) => {
  const dirs = [CONSTANTS.listDirectoryName, `${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotDirectoryName}`]
  for (const dir of dirs) {
    try {
      await webDAV.ls(dir)
    } catch (error) {
      if (!is404Error(error)) throw error
      log('info', `创建缺失的目录: ${dir}`)
      await webDAV.mkdir(dir)
    }
  }
}

const runListSync = async(
  options: Options<RemoteListDataFull>,
  getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>,
) => {
  const deviceId = getDeviceId()
  const snapshotInfo = await options.getSnapshotInfo()
  log('info', `歌单同步开始：设备ID=${deviceId}，远端 latest=${snapshotInfo?.latest ?? '(空)'}，本机快照=${snapshotInfo?.clients?.[deviceId]?.snapshotKey ?? '(无)'}`)
  if (snapshotInfo?.latest) {
    const client = snapshotInfo.clients[deviceId]
    if (client?.snapshotKey) {
      const localData = toRemoteListData(await getLocalListData())
      const localKey = getListDataMD5(localData)
      log('info', `本地数据 MD5=${localKey}，远端 latest=${snapshotInfo.latest}，本机快照=${client.snapshotKey}`)
      if (localKey === snapshotInfo.latest) {
        if (localKey === client.snapshotKey) {
          log('info', '本地与远端完全一致，无需同步')
          return
        }
        client.snapshotKey = localKey
        client.lastSyncTime = Date.now()
        await options.saveSnapshotInfo(snapshotInfo)
        const sdm = new SnapshotDataManage(options, getListDataMD5)
        await sdm.init(snapshotInfo)
        await sdm.clearOldSnapshot()
        return
      }
      if (localKey === client.snapshotKey) {
        log('info', '本地未变更，用远端最新快照覆盖本地')
        const latest = await options.getSnapshotData(snapshotInfo.latest)
        if (!latest) throw new Error('Latest snapshot data not found')
        await options.overwriteLocalList(latest)
        const sdm = new SnapshotDataManage(options, getListDataMD5)
        await sdm.init(snapshotInfo)
        await sdm.saveSnapshotData(deviceId, latest)
        return
      }
      const localListData = toRemoteListData(await getLocalListData())
      let latestData: RemoteListDataFull | null
      let snapshotData: RemoteListDataFull | null
      if (snapshotInfo.latest == client.snapshotKey) {
        latestData = await options.getSnapshotData(snapshotInfo.latest)
        snapshotData = latestData
      } else {
        ;[latestData, snapshotData] = await Promise.all([
          options.getSnapshotData(snapshotInfo.latest),
          options.getSnapshotData(client.snapshotKey),
        ])
      }
      if (!latestData || !snapshotData) throw new Error('Snapshot data not found')
      log('info', '本地与远端均有变更，执行三方合并')
      const newData = mergeFullDataFromSnapshot(
        localListData,
        latestData,
        snapshotData,
        settingState.setting['list.addMusicLocationType'],
      )
      await options.overwriteLocalList(newData)
      const sdm = new SnapshotDataManage(options, getListDataMD5)
      await sdm.init(snapshotInfo)
      await sdm.saveSnapshotData(deviceId, newData)
      return
    }
    if (getListMergeMode) {
      const [latestData, localListData] = await Promise.all([
        options.getSnapshotData(snapshotInfo.latest),
        getLocalListData().then((d) => toRemoteListData(d)),
      ])
      if (!latestData) throw new Error('Snapshot data not found')
      log('info', '本机无历史快照，向用户询问合并方式')
      const [merged, updateLocal] = await mergeFullData(
        localListData,
        latestData,
        settingState.setting['list.addMusicLocationType'],
        getListMergeMode,
        async() => toRemoteListData(await getLocalListData()),
      )
      if (updateLocal) await options.overwriteLocalList(merged)
      const sdm = new SnapshotDataManage(options, getListDataMD5)
      await sdm.init(snapshotInfo)
      await sdm.saveSnapshotData(deviceId, merged)
      return
    }
    throw new Error('Local list data is different from the latest snapshot data, but no merge mode is provided')
  }
  const localListData = toRemoteListData(await getLocalListData())
  log('info', '远端无任何快照，将本地数据上传为首个快照')
  const sdm = new SnapshotDataManage(options, getListDataMD5)
  await sdm.init(snapshotInfo)
  await sdm.saveSnapshotData(deviceId, localListData)
}

export const runSyncList = async(webDAV: WebDAV, getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>) => {
  await runListSync(
    {
      async getSnapshotInfo() {
        let file: string | undefined
        try {
          file = await webDAV.get(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotInfoFileName}`)
        } catch (error) {
          if (!is404Error(error)) throw error
          await checkListDirs(webDAV)
        }
        return file ? (JSON.parse(decodeData(file)) as SnapshotInfo) : null
      },
      async saveSnapshotInfo(info) {
        await webDAV.put(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotInfoFileName}`, encodeData(JSON.stringify(info)))
      },
      async getSnapshotList() {
        try {
          const file = await webDAV.get(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotListFileName}`)
          const raw = decodeData(file)
          return raw ? (JSON.parse(raw) as string[]) : []
        } catch (error) {
          if (!is404Error(error)) throw error
          return []
        }
      },
      async saveSnapshotList(list) {
        await webDAV.put(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotListFileName}`, encodeData(JSON.stringify(list)))
      },
      async getSnapshotData(key) {
        try {
          const file = await webDAV.get(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`)
          return file == null ? null : (JSON.parse(decodeData(file)) as RemoteListDataFull)
        } catch (error) {
          if (!is404Error(error)) throw error
          return null
        }
      },
      async removeSnapshot(key) {
        await webDAV
          .rm(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`)
          .catch((error) => {
            if (!is404Error(error)) throw error
          })
      },
      async saveSnapshotData(key, data) {
        await webDAV.put(`${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`, encodeData(JSON.stringify(data)))
      },
      async overwriteLocalList(data) {
        await setLocalListData(fromRemoteListData(data))
      },
    },
    getListMergeMode,
  )
}

// ----------------------------------------------------------------------------
// 不喜欢规则同步（规则为纯字符串，与 any-listen 一致）
// ----------------------------------------------------------------------------

const checkDislikeDirs = async(webDAV: WebDAV) => {
  const dirs = [CONSTANTS.dislikeDirectoryName, `${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}`]
  for (const dir of dirs) {
    try {
      await webDAV.ls(dir)
    } catch (error) {
      if (!is404Error(error)) throw error
      log('info', `创建缺失的目录: ${dir}`)
      await webDAV.mkdir(dir)
    }
  }
}

const runDislikeSync = async(
  options: Options<string>,
  getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>,
) => {
  const deviceId = getDeviceId()
  const snapshotInfo = await options.getSnapshotInfo()
  log('info', `不喜欢规则同步开始：设备ID=${deviceId}，远端 latest=${snapshotInfo?.latest ?? '(空)'}`)
  if (snapshotInfo?.latest) {
    const client = snapshotInfo.clients[deviceId]
    if (client?.snapshotKey) {
      const localKey = getDislikeRulesMD5(await getLocalDislikeData())
      log('info', `本地规则 MD5=${localKey}，远端 latest=${snapshotInfo.latest}，本机快照=${client.snapshotKey}`)
      if (localKey === snapshotInfo.latest) {
        if (localKey === client.snapshotKey) {
          log('info', '本地与远端完全一致，无需同步')
          return
        }
        client.snapshotKey = localKey
        client.lastSyncTime = Date.now()
        await options.saveSnapshotInfo(snapshotInfo)
        const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
        await sdm.init(snapshotInfo)
        await sdm.clearOldSnapshot()
        return
      }
      if (localKey === client.snapshotKey) {
        const latest = await options.getSnapshotData(snapshotInfo.latest)
        if (latest == null) throw new Error('Latest snapshot data not found')
        await options.overwriteLocalList(latest)
        const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
        await sdm.init(snapshotInfo)
        await sdm.saveSnapshotData(deviceId, latest)
        return
      }
      const localData = await getLocalDislikeData()
      let latestData: string | null
      let snapshotData: string | null
      if (snapshotInfo.latest == client.snapshotKey) {
        latestData = await options.getSnapshotData(snapshotInfo.latest)
        snapshotData = latestData
      } else {
        ;[latestData, snapshotData] = await Promise.all([
          options.getSnapshotData(snapshotInfo.latest),
          options.getSnapshotData(client.snapshotKey),
        ])
      }
      if (latestData == null || snapshotData == null) throw new Error('Snapshot data not found')
      const newData = mergeDislikeFullDataFromSnapshot(localData, latestData, snapshotData)
      await options.overwriteLocalList(newData)
      const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
      await sdm.init(snapshotInfo)
      await sdm.saveSnapshotData(deviceId, newData)
      return
    }
    if (getDislikeMergeMode) {
      const [latestData, localData] = await Promise.all([
        options.getSnapshotData(snapshotInfo.latest),
        getLocalDislikeData(),
      ])
      if (latestData == null) throw new Error('Snapshot data not found')
      const [merged, updateLocal] = await mergeDislikeFullData(
        localData,
        latestData,
        getDislikeMergeMode,
        async() => getLocalDislikeData(),
      )
      if (updateLocal) await options.overwriteLocalList(merged)
      const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
      await sdm.init(snapshotInfo)
      await sdm.saveSnapshotData(deviceId, merged)
      return
    }
    throw new Error('Local dislike data is different from the latest snapshot data, but no merge mode is provided')
  }
  const localData = await getLocalDislikeData()
  log('info', '远端无规则快照，将本地规则上传为首个快照')
  const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
  await sdm.init(snapshotInfo)
  await sdm.saveSnapshotData(deviceId, localData)
}

export const runSyncDislike = async(webDAV: WebDAV, getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>) => {
  await runDislikeSync(
    {
      async getSnapshotInfo() {
        let file: string | undefined
        try {
          file = await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotInfoFileName}`)
        } catch (error) {
          if (!is404Error(error)) throw error
          await checkDislikeDirs(webDAV)
        }
        return file ? (JSON.parse(decodeData(file)) as SnapshotInfo) : null
      },
      async saveSnapshotInfo(info) {
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotInfoFileName}`, encodeData(JSON.stringify(info)))
      },
      async getSnapshotList() {
        try {
          const file = await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotListFileName}`)
          const raw = decodeData(file)
          return raw ? (JSON.parse(raw) as string[]) : []
        } catch (error) {
          if (!is404Error(error)) throw error
          return []
        }
      },
      async saveSnapshotList(list) {
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotListFileName}`, encodeData(JSON.stringify(list)))
      },
      async getSnapshotData(key) {
        try {
          const file = await webDAV.get(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`)
          return file ?? null
        } catch (error) {
          if (!is404Error(error)) throw error
          return null
        }
      },
      async removeSnapshot(key) {
        await webDAV
          .rm(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`)
          .catch((error) => {
            if (!is404Error(error)) throw error
          })
      },
      async saveSnapshotData(key, data) {
        await webDAV.put(`${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}/${key}`, encodeData(data))
      },
      async overwriteLocalList(data) {
        await setLocalDislikeData(data)
      },
    },
    getDislikeMergeMode,
  )
}

// ----------------------------------------------------------------------------
// 音源（自定义源）同步
//
// 与歌单/不喜欢不同，音源按 id 合并即可，无需三方合并：
//   - 本地缺失 → 导入
//   - 本地存在且远端 version 更新 → 覆盖
//   - 否则保留本地；本地独有的一律保留（不因同步而删除用户手动导入的音源）
// ----------------------------------------------------------------------------

const checkUserApiDirs = async(webDAV: WebDAV) => {
  try {
    await webDAV.ls(USER_API_DIR)
  } catch (error) {
    if (!is404Error(error)) throw error
    log('info', `创建缺失的目录: ${USER_API_DIR}`)
    await webDAV.mkdir(USER_API_DIR)
  }
}

/**
 * 音源指纹：按 id 排序后序列化，保证与文件顺序无关；
 * 用于判断本地与远端是否一致（与 list/dislike 的快照机制保持一致）。
 */
const getUserApiDataMD5 = async(): Promise<string> => {
  const items = await getLocalUserApiList()
  const normalized = [...items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((i) => ({ id: i.id, version: i.info.version }))
  return stringMd5(JSON.stringify(normalized))
}

/** 读取远端 music-source 目录下的所有音源（每个 .js 一个音源） */
const readRemoteUserApi = async(webDAV: WebDAV): Promise<RemoteUserApiItem[]> => {
  await checkUserApiDirs(webDAV)
  const files = await webDAV.ls(USER_API_DIR)

  // meta.json 提供完整元信息；缺失时用脚本头部信息兜底
  let metaMap = new Map<string, LX.UserApi.UserApiInfo>()
  const metaFile = files.find((f) => f.name === USER_API_META_FILE)
  if (metaFile) {
    try {
      const raw = decodeData(await webDAV.get(`${USER_API_DIR}/${USER_API_META_FILE}`))
      const meta = parseUserApiMeta(JSON.parse(raw))
      metaMap = new Map(meta.list.map((i) => [i.id, i]))
      log('info', `读取远端音源元信息 ${meta.list.length} 条`)
    } catch (err) {
      log('warn', '解析远端音源元信息失败，将仅按脚本文件处理', err)
    }
  }

  const items: RemoteUserApiItem[] = []
  for (const file of files) {
    if (file.isDir) continue
    const id = fromFileName(file.name)
    if (!id) continue
    try {
      const script = await webDAV.get(`${USER_API_DIR}/${file.name}`)
      if (!script) continue
      // 从脚本头解析出权威元信息（name/version/author/homepage 等），
      // 与本地 addUserApi 导入时保持一致。meta.json 仅是索引，其 info 字段往往缺失或为空
      // （例如 version 为空），若直接用它作为 info，脚本 init 时发给服务端的版本/标识不符，
      // 会被服务端拒绝并抛「服务器异常」。故优先使用脚本头解析结果，meta 仅作缺失兜底。
      const header = /^\/\*[\S|\s]+?\*\//.exec(script)
      const scriptInfo: Partial<LX.UserApi.UserApiInfo> = header ? parseUserApiScriptInfo(header[0]) : {}
      const meta = metaMap.get(id)
      // 取第一个非空值：脚本头解析结果优先，meta 兜底，最后退回远端 id
      const pick = (...vals: Array<string | undefined>): string => vals.find((v) => !!v) ?? ''
      const info: LX.UserApi.UserApiInfo = {
        id,
        name: pick(scriptInfo.name, meta?.name, id),
        description: pick(scriptInfo.description, meta?.description),
        author: pick(scriptInfo.author, meta?.author),
        homepage: pick(scriptInfo.homepage, meta?.homepage),
        version: pick(scriptInfo.version, meta?.version),
        allowShowUpdateAlert: meta?.allowShowUpdateAlert ?? true,
      }
      items.push({ id, info, script })
    } catch (err) {
      log('warn', `读取远端音源文件失败: ${file.name}`, err)
    }
  }
  log('info', `远端共读取到 ${items.length} 个音源脚本`)
  return items
}

/** 上传本地全部音源：每个音源写一个 .js 文件，外加 meta.json */
const writeRemoteUserApi = async(webDAV: WebDAV, items: RemoteUserApiItem[]): Promise<void> => {
  await checkUserApiDirs(webDAV)

  // 删除远端已不存在的音源文件，避免残留
  // 注意：items 中的 id 是本地前缀 id，需转成远端裸 id 才能与远端文件名对应
  const remoteFiles = await webDAV.ls(USER_API_DIR)
  const remoteIds = new Set(remoteFiles.filter((f) => !f.isDir).map((f) => fromFileName(f.name)).filter((v): v is string => !!v))
  const localRemoteIds = new Set(items.map((i) => toRemoteId(i.id)))
  for (const id of remoteIds) {
    if (localRemoteIds.has(id)) continue
    log('info', `删除远端已不存在的音源: ${id}`)
    await webDAV.rm(`${USER_API_DIR}/${toFileName(id)}`).catch((err) => {
      if (!is404Error(err)) throw err
    })
  }

  for (const { id, info, script } of items) {
    await webDAV.put(`${USER_API_DIR}/${toFileName(id)}`, script)
    log('info', `上传音源文件: ${toFileName(id)} (${info.name})`)
  }
  await webDAV.put(`${USER_API_DIR}/${USER_API_META_FILE}`, encodeData(JSON.stringify(buildUserApiMeta(items))))
  log('info', `共上传 ${items.length} 个音源，元信息已写入 ${USER_API_META_FILE}`)
}

/** 用远端音源合并到本地，并刷新 store */
const applyRemoteUserApi = async(webDAV: WebDAV): Promise<void> => {
  const items = await readRemoteUserApi(webDAV)
  if (!items.length) {
    log('info', '远端无音源，跳过合并')
    return
  }
  const res = await mergeRemoteUserApiList(items)
  log('info', `音源合并结果：新增 ${res.added}，更新 ${res.updated}，跳过 ${res.skipped}`)
  // 合并后刷新 store，使 UI 立即可见。
  // 刷新会触发音源脚本加载，其内部网络请求失败（如脚本依赖本地代理）不应
  // 影响同步结果，故此处吞掉异常。
  try {
    const { setUserApiList } = await import('@/core/userApi')
    setUserApiList(await getUserApiList())
  } catch (err) {
    log('warn', '刷新音源列表 UI 失败（不影响同步结果）', err)
  }

  // 迁移激活音源设置：旧版本写下的 common.apiSource 可能是缺前缀的裸 id
  // （如「野花v1」），若不修正，setApiSource 仍走 else 分支（destroyUserApi），
  // 播放会继续「换源失败」。将其映射到规范化后的前缀 id 并立即重新激活。
  try {
    const current = settingState.setting['common.apiSource']
    if (current && normalizeLocalId(current) !== current) {
      // 远端音源裸 id → 本地前缀 id
      const remap = new Map(items.map((i) => [i.id, normalizeLocalId(i.id)]))
      let newId = remap.get(current)
      if (!newId) {
        // 也可能是本地独有（远端没有）的裸 id 被规范化
        const local = (await getUserApiList()).find((i) => i.id === normalizeLocalId(current) || i.id === current)
        newId = local?.id
      }
      if (newId && newId !== current) {
        setApiSource(newId)
        log('info', `已将激活音源设置从 ${current} 迁移为 ${newId}`)
      }
    }
  } catch (err) {
    log('warn', '迁移激活音源设置失败（可手动在设置中重新选择）', err)
  }

  // 同步后若当前没有可用音源（例如首次同步、同步前的音源已被删除），
  // 自动激活一个已安装的自定义源。
  // 否则本项目（已移除全部内置音源）会没有任何可用音源，播放会一直失败。
  try {
    const { isApiSourceAvailable, getAvailableUserApiId } = await import('@/core/apiSource')
    if (!isApiSourceAvailable(settingState.setting['common.apiSource'])) {
      const fallback = getAvailableUserApiId()
      if (fallback) {
        setApiSource(fallback)
        log('info', `同步后自动激活音源：${fallback}`)
      }
    }
  } catch (err) {
    log('warn', '同步后自动激活音源失败（可手动在设置中选择）', err)
  }
}

const runUserApiSync = async(webDAV: WebDAV) => {
  log('info', `音源同步开始：设备ID=${getDeviceId()}，目录=${USER_API_DIR}`)

  // 1) 先把远端音源合并到本地（新增/更新/远端删除均在此处理）
  await applyRemoteUserApi(webDAV)

  // 2) 再上传合并后的完整结果（本地删除的音源会在此从远端清除）
  const items = await getLocalUserApiList()
  await writeRemoteUserApi(webDAV, items)

  // 3) 所有当前本地音源均视为“已建立同步关系”，后续任一端删除都会双向同步
  await saveSyncedIds(new Set(items.map((i) => normalizeLocalId(i.id))))

  const key = await getUserApiDataMD5()
  log('info', `音源同步完成，共 ${items.length} 个，指纹=${key}`)
}

export const runSyncUserApi = async(webDAV: WebDAV) => {
  await runUserApiSync(webDAV)
}

// ----------------------------------------------------------------------------
// 编排：歌单 + 不喜欢 + 音源 顺序同步，加锁期间执行（锁逻辑在 WebDAV 类中）
// ----------------------------------------------------------------------------

export interface SyncOptions {
  onEnd: (error?: Error) => void
  getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>
  getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>
  syncUserApi?: boolean
}

const wrapMergeMode = <T extends SyncOptions['getListMergeMode'] | SyncOptions['getDislikeMergeMode'] | undefined>(
  fn: T,
  webDAV: WebDAV,
): T => {
  if (!fn) return undefined as T
  return (async() => {
    const mode = await fn()
    if (mode !== 'cancel') {
      if (!(await webDAV.checkCurrentLock())) throw new Error('Lock file is missing, sync cancelled')
    }
    return mode
  }) as T
}

export const runSync = (webDAV: WebDAV, options: SyncOptions) => {
  const syncTasks: Array<(webDAV: WebDAV) => Promise<void>> = []
  syncTasks.push(async() => runSyncList(webDAV, wrapMergeMode(options.getListMergeMode, webDAV)))
  syncTasks.push(async() => runSyncDislike(webDAV, wrapMergeMode(options.getDislikeMergeMode, webDAV)))
  if (options.syncUserApi) syncTasks.push(async() => runSyncUserApi(webDAV))

  let cancelled = false
  const cancel = () => {
    cancelled = true
  }
  const runNextTask = async(index: number) => {
    if (index >= syncTasks.length || cancelled) {
      options.onEnd(cancelled ? new Error('cancel') : undefined)
      return
    }
    try {
      await syncTasks[index](webDAV)
      void runNextTask(index + 1)
    } catch (error) {
      options.onEnd(error as Error)
    }
  }
  void runNextTask(0)
  return cancel
}
