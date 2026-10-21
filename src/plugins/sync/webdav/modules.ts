import { WebDAV, is404Error } from './webdav'
import { CONSTANTS, decodeData, encodeData, getDeviceId } from './shared'
import { getLocalListData, setLocalListData } from '@/plugins/sync/listEvent'
import { getLocalDislikeData, setLocalDislikeData } from '@/plugins/sync/dislikeEvent'
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

// ----------------------------------------------------------------------------
// 歌单同步（与 any-listen 的 webdav/modules/list.ts + shared/list/index.ts 对齐）
// ----------------------------------------------------------------------------

const checkListDirs = async (webDAV: WebDAV) => {
  const dirs = [CONSTANTS.listDirectoryName, `${CONSTANTS.listDirectoryName}/${CONSTANTS.snapshotDirectoryName}`]
  for (const dir of dirs) {
    try {
      await webDAV.ls(dir)
    } catch (error) {
      if (!is404Error(error)) throw error
      await webDAV.mkdir(dir)
    }
  }
}

const runListSync = async (
  options: Options<RemoteListDataFull>,
  getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>,
) => {
  const deviceId = getDeviceId()
  const snapshotInfo = await options.getSnapshotInfo()
  if (snapshotInfo?.latest) {
    const client = snapshotInfo.clients[deviceId]
    if (client?.snapshotKey) {
      const localData = toRemoteListData(await getLocalListData())
      const localKey = getListDataMD5(localData)
      if (localKey === snapshotInfo.latest) {
        if (localKey === client.snapshotKey) return
        client.snapshotKey = localKey
        client.lastSyncTime = Date.now()
        await options.saveSnapshotInfo(snapshotInfo)
        const sdm = new SnapshotDataManage(options, getListDataMD5)
        await sdm.init(snapshotInfo)
        await sdm.clearOldSnapshot()
        return
      }
      if (localKey === client.snapshotKey) {
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
      const [merged, updateLocal] = await mergeFullData(
        localListData,
        latestData,
        settingState.setting['list.addMusicLocationType'],
        getListMergeMode,
        async () => toRemoteListData(await getLocalListData()),
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
  const sdm = new SnapshotDataManage(options, getListDataMD5)
  await sdm.init(snapshotInfo)
  await sdm.saveSnapshotData(deviceId, localListData)
}

export const runSyncList = async (webDAV: WebDAV, getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>) => {
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

const checkDislikeDirs = async (webDAV: WebDAV) => {
  const dirs = [CONSTANTS.dislikeDirectoryName, `${CONSTANTS.dislikeDirectoryName}/${CONSTANTS.snapshotDirectoryName}`]
  for (const dir of dirs) {
    try {
      await webDAV.ls(dir)
    } catch (error) {
      if (!is404Error(error)) throw error
      await webDAV.mkdir(dir)
    }
  }
}

const runDislikeSync = async (
  options: Options<string>,
  getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>,
) => {
  const deviceId = getDeviceId()
  const snapshotInfo = await options.getSnapshotInfo()
  if (snapshotInfo?.latest) {
    const client = snapshotInfo.clients[deviceId]
    if (client?.snapshotKey) {
      const localKey = getDislikeRulesMD5(await getLocalDislikeData())
      if (localKey === snapshotInfo.latest) {
        if (localKey === client.snapshotKey) return
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
        async () => getLocalDislikeData(),
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
  const sdm = new SnapshotDataManage(options, getDislikeRulesMD5)
  await sdm.init(snapshotInfo)
  await sdm.saveSnapshotData(deviceId, localData)
}

export const runSyncDislike = async (webDAV: WebDAV, getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>) => {
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
          return file == null ? null : file
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
// 编排：歌单 + 不喜欢 顺序同步，加锁期间执行（锁逻辑在 WebDAV 类中）
// ----------------------------------------------------------------------------

export interface SyncOptions {
  onEnd: (error?: Error) => void
  getListMergeMode?: () => Promise<LX.Sync.List.SyncMode>
  getDislikeMergeMode?: () => Promise<LX.Sync.Dislike.SyncMode>
}

const wrapMergeMode = <T extends SyncOptions['getListMergeMode'] | SyncOptions['getDislikeMergeMode'] | undefined>(
  fn: T,
  webDAV: WebDAV,
): T => {
  if (!fn) return undefined as T
  return (async () => {
    const mode = await fn()
    if (mode !== 'cancel') {
      if (!(await webDAV.checkCurrentLock())) throw new Error('Lock file is missing, sync cancelled')
    }
    return mode
  }) as T
}

export const runSync = (webDAV: WebDAV, options: SyncOptions) => {
  const syncTasks: Array<(webDAV: WebDAV) => Promise<void>> = []
  syncTasks.push(async () => runSyncList(webDAV, wrapMergeMode(options.getListMergeMode, webDAV)))
  syncTasks.push(async () => runSyncDislike(webDAV, wrapMergeMode(options.getDislikeMergeMode, webDAV)))

  let cancelled = false
  const cancel = () => {
    cancelled = true
  }
  const runNextTask = async (index: number) => {
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
