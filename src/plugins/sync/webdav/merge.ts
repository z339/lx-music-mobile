import { SPLIT_CHAR } from '@/config/constant'
import { CANCELED_ERROR_MSG, getDeviceId } from './shared'
import type { RemoteListDataFull, RemoteListInfoFull, RemoteMusicInfo, RemoteUserListInfo } from './types'

// ============================================================================
// 歌单合并（移植自 any-listen，仅将 ListDataFull 替换为 any-listen 兼容的
// RemoteListDataFull；其 meta 字段在写入远端时已合成，故三方合并逻辑可直接复用）
// ============================================================================

type MusicInfo = RemoteMusicInfo
type ListData = RemoteListDataFull
type AddMusicLocationType = LX.AddMusicLocationType

const mergeMusicList = (
  sourceList: MusicInfo[],
  targetList: MusicInfo[],
  snapshotList: MusicInfo[] | null,
  addMusicLocationType: AddMusicLocationType,
): MusicInfo[] => {
  const removedIds = new Set<string | number>()
  const sourceIds = new Set<string | number>()
  const latestIds = new Set<string | number>()
  for (const m of sourceList) sourceIds.add(m.id)
  for (const m of targetList) latestIds.add(m.id)
  if (snapshotList) {
    for (const m of snapshotList) {
      if (!sourceIds.has(m.id) || !latestIds.has(m.id)) removedIds.add(m.id)
    }
  }

  const map = new Map<string | number, MusicInfo>()
  const ids: Array<string | number> = []
  const deviceId = getDeviceId()
  for (const item of sourceList) {
    if (removedIds.has(item.id)) continue
    ids.push(item.id)
    map.set(item.id, item)
  }
  switch (addMusicLocationType) {
    case 'top':
      for (let i = targetList.length - 1; i > -1; i--) {
        const item = targetList[i]
        if (removedIds.has(item.id)) continue
        const targetItem = map.get(item.id)
        if (targetItem) {
          if (item.meta.updateTime >= targetItem.meta.updateTime) {
            map.set(item.id, item)
          } else if (item.isLocal) {
            if (targetItem.meta.deviceId != item.meta.deviceId && targetItem.meta.deviceId != deviceId) {
              map.set(item.id, item)
            }
          }
        } else {
          ids.unshift(item.id)
          map.set(item.id, item)
        }
      }
      break
    default:
      for (const item of targetList) {
        if (removedIds.has(item.id)) continue
        const targetItem = map.get(item.id)
        if (targetItem) {
          if (item.meta.updateTime >= targetItem.meta.updateTime) {
            map.set(item.id, item)
          } else if (item.isLocal) {
            if (targetItem.meta.deviceId != item.meta.deviceId && targetItem.meta.deviceId != deviceId) {
              map.set(item.id, item)
            }
          }
        } else {
          ids.push(item.id)
          map.set(item.id, item)
        }
      }
      break
  }
  return ids.map((id) => map.get(id)!)
}

const mergeUserList = <T extends RemoteListInfoFull>(
  sourceListData: T,
  targetListData: T,
  snapshotListData: T | null,
  addMusicLocationType: AddMusicLocationType,
): T => {
  let list: MusicInfo[]
  if (sourceListData.id === 'default' || sourceListData.id === 'love') {
    list = mergeMusicList(sourceListData.list, targetListData.list, snapshotListData?.list ?? null, addMusicLocationType)
  } else {
    const sourceTime = sourceListData.meta.syncTime || 0
    const targetTime = ('syncTime' in targetListData.meta ? targetListData.meta.syncTime : 0) || 0
    const snapshotTime = (snapshotListData && 'syncTime' in snapshotListData.meta ? snapshotListData.meta.syncTime : 0) || 0
    const max = Math.max(sourceTime, targetTime, snapshotTime)
    sourceListData.meta.syncTime = max
    if ('syncTime' in targetListData.meta) targetListData.meta.syncTime = max
    const target =
      max === sourceTime ? sourceListData : max === targetTime ? targetListData : (snapshotListData ?? sourceListData)
    list = target.list
  }
  const selected = sourceListData.meta.updateTime > targetListData.meta.updateTime ? sourceListData : targetListData
  const snapshotPlayCount = snapshotListData?.meta.playCount || 0
  let playCount: number
  if (snapshotPlayCount) {
    playCount = sourceListData.meta.playCount - snapshotPlayCount
    if (playCount < 0) playCount = targetListData.meta.playCount - snapshotPlayCount + sourceListData.meta.playCount
    else playCount += targetListData.meta.playCount
  } else playCount = sourceListData.meta.playCount + targetListData.meta.playCount
  const newInfo: T = {
    ...selected,
    meta: {
      ...selected.meta,
      playCount,
    },
    list,
  }
  newInfo.meta.songCount = list.length
  return newInfo
}

const createUserListDataObj = (listData: ListData | null): Map<string, RemoteUserListInfo> => {
  const obj = new Map<string, RemoteUserListInfo>()
  if (listData) {
    for (const list of listData.userList) obj.set(list.id, list)
  }
  return obj
}

// 三方合并：以「共同祖先快照(snapshot)」识别被两边同时删除的条目，避免复活
export const mergeFullDataFromSnapshot = (
  localListData: ListData,
  latestListData: ListData,
  snapshotListData: ListData | null,
  addMusicLocationType: AddMusicLocationType,
): ListData => {
  const newListData: ListData = {
    defaultList: mergeUserList(
      localListData.defaultList,
      latestListData.defaultList,
      snapshotListData?.defaultList ?? null,
      addMusicLocationType,
    ),
    loveList: mergeUserList(
      localListData.loveList,
      latestListData.loveList,
      snapshotListData?.loveList ?? null,
      addMusicLocationType,
    ),
    userList: [],
  }
  const localUserListData = createUserListDataObj(localListData)
  const latestUserListData = createUserListDataObj(latestListData)
  const snapshotUserListData = createUserListDataObj(snapshotListData)
  const removedIds = new Set<string | number>()
  const localUserIds = new Set<string | number>()
  const remoteUserIds = new Set<string | number>()
  for (const l of localListData.userList) localUserIds.add(l.id)
  for (const l of latestListData.userList) remoteUserIds.add(l.id)
  if (snapshotListData) {
    for (const l of snapshotListData.userList) {
      if (!localUserIds.has(l.id) || !remoteUserIds.has(l.id)) removedIds.add(l.id)
    }
  }

  const newUserList: RemoteUserListInfo[] = []
  for (const list of latestListData.userList) {
    if (removedIds.has(list.id)) continue
    const localList = localUserListData.get(list.id)
    newUserList.push(localList ? mergeUserList(localList, list, snapshotUserListData.get(list.id) ?? null, addMusicLocationType) : { ...list })
  }
  localListData.userList.forEach((list, index) => {
    if (removedIds.has(list.id)) return
    const localUpdateTime = list.meta.posTime || 0
    if (latestUserListData.has(list.id)) {
      const latestUpdateTime = latestUserListData.get(list.id)!.meta.posTime || 0
      if (latestUpdateTime >= localUpdateTime) return
      const [newList] = newUserList.splice(newUserList.findIndex((l) => l.id == list.id), 1)
      newList.meta.posTime = localUpdateTime
      newUserList.splice(index, 0, newList)
    } else if (localUpdateTime) {
      newUserList.splice(index, 0, { ...list })
    } else {
      newUserList.push({ ...list })
    }
  })
  newListData.userList = newUserList
  return newListData
}

const handleMergeListData = async (
  remoteListData: ListData,
  addMusicLocationType: AddMusicLocationType,
  getListMergeMode: () => Promise<LX.Sync.List.SyncMode>,
  getLocalListData: () => Promise<ListData>,
): Promise<[ListData, boolean, boolean]> => {
  const now = Date.now()
  const mode = await getListMergeMode()
  if (mode == 'cancel') throw new Error(CANCELED_ERROR_MSG)
  if (Date.now() - now > 120_000) throw new Error('getListMergeMode timeout')
  let listData: ListData
  let requiredUpdateLocalListData = true
  let requiredUpdateRemoteListData = true
  switch (mode) {
    case 'merge_local_remote':
      listData = mergeFullDataLocal(await getLocalListData(), remoteListData, addMusicLocationType)
      break
    case 'merge_remote_local':
      listData = mergeFullDataLocal(remoteListData, await getLocalListData(), addMusicLocationType)
      break
    case 'overwrite_local_remote':
      listData = overwriteListLocal(await getLocalListData(), remoteListData)
      break
    case 'overwrite_remote_local':
      listData = overwriteListLocal(remoteListData, await getLocalListData())
      break
    case 'overwrite_local_remote_full':
      listData = await getLocalListData()
      requiredUpdateLocalListData = false
      break
    case 'overwrite_remote_local_full':
      listData = remoteListData
      requiredUpdateRemoteListData = false
      break
    default:
      throw new Error(CANCELED_ERROR_MSG)
  }
  return [listData, requiredUpdateLocalListData, requiredUpdateRemoteListData]
}

const mergeFullDataLocal = (source: ListData, target: ListData, addMusicLocationType: AddMusicLocationType): ListData => {
  const newListData: ListData = {
    defaultList: mergeUserList(source.defaultList, target.defaultList, null, addMusicLocationType),
    loveList: mergeUserList(source.loveList, target.loveList, null, addMusicLocationType),
    userList: [],
  }
  const sourceUserObj = createUserListDataObj(source)
  const targetUserObj = createUserListDataObj(target)
  const newUserList: RemoteUserListInfo[] = []
  for (const list of source.userList) {
    const targetList = targetUserObj.get(list.id)
    newUserList.push(targetList ? mergeUserList(list, targetList, null, addMusicLocationType) : { ...list })
  }
  target.userList.forEach((list, index) => {
    const targetUpdateTime = list.meta.posTime || 0
    if (sourceUserObj.has(list.id)) {
      const sourceUpdateTime = sourceUserObj.get(list.id)!.meta.posTime || 0
      if (sourceUpdateTime >= targetUpdateTime) return
      const [newList] = newUserList.splice(newUserList.findIndex((l) => l.id == list.id), 1)
      newList.meta.posTime = targetUpdateTime
      newUserList.splice(index, 0, newList)
    } else if (targetUpdateTime) {
      newUserList.splice(index, 0, { ...list })
    } else {
      newUserList.push({ ...list })
    }
  })
  newListData.userList = newUserList
  return newListData
}

const overwriteListLocal = (source: ListData, target: ListData): ListData => {
  const newListData: ListData = {
    defaultList: source.defaultList,
    loveList: source.loveList,
    userList: [],
  }
  const sourceUserObj = createUserListDataObj(source)
  newListData.userList = [...source.userList]
  target.userList.forEach((list, index) => {
    if (sourceUserObj.has(list.id)) return
    if (list.meta.posTime) newListData.userList.splice(index, 0, list)
    else newListData.userList.push(list)
  })
  return newListData
}

const checkListDataEmpty = (listData: ListData): boolean =>
  !listData.defaultList.list.length && !listData.loveList.list.length && !listData.userList.length

export const mergeFullData = async (
  localListData: ListData,
  remoteListData: ListData,
  addMusicLocationType: AddMusicLocationType,
  getListMergeMode: () => Promise<LX.Sync.List.SyncMode>,
  getLocalListData: () => Promise<ListData>,
): Promise<[ListData, boolean, boolean]> => {
  if (checkListDataEmpty(localListData)) {
    if (checkListDataEmpty(remoteListData)) return [localListData, false, false]
    return [remoteListData, true, false]
  }
  if (checkListDataEmpty(remoteListData)) return [localListData, false, true]
  return handleMergeListData(remoteListData, addMusicLocationType, getListMergeMode, getLocalListData)
}

// ============================================================================
// 不喜欢规则合并（规则为纯字符串，分隔符与 any-listen 一致：`name@singer`）
// ============================================================================

export const filterRules = (rules: string): Set<string> => {
  const list: string[] = []
  for (const item of rules.split('\n')) {
    if (!item) continue
    let [name, singer] = item.split(SPLIT_CHAR.DISLIKE_NAME)
    if (name) {
      name = name.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      if (singer) {
        singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
        list.push(`${name}${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
      } else {
        list.push(name)
      }
    } else if (singer) {
      singer = singer.replaceAll(SPLIT_CHAR.DISLIKE_NAME, SPLIT_CHAR.DISLIKE_NAME_ALIAS).toLocaleLowerCase().trim()
      list.push(`${SPLIT_CHAR.DISLIKE_NAME}${singer}`)
    }
  }
  return new Set(list)
}

const mergeRules = (source: string, target: string): string =>
  Array.from(filterRules(`${source}\n${target}`)).join('\n')

const handleMergeRulesData = async (
  remote: string,
  getMergeMode: () => Promise<LX.Sync.Dislike.SyncMode>,
  getLocal: () => Promise<string>,
): Promise<[string, boolean, boolean]> => {
  const now = Date.now()
  const mode = await getMergeMode()
  if (mode == 'cancel') throw new Error(CANCELED_ERROR_MSG)
  if (Date.now() - now > 120_000) throw new Error('getMergeMode timeout')
  let rules: string
  let requiredUpdateLocal = true
  let requiredUpdateRemote = true
  switch (mode) {
    case 'merge_local_remote':
      rules = mergeRules(await getLocal(), remote)
      break
    case 'merge_remote_local':
      rules = mergeRules(remote, await getLocal())
      break
    case 'overwrite_local_remote':
      rules = await getLocal()
      requiredUpdateLocal = false
      break
    case 'overwrite_remote_local':
      rules = remote
      requiredUpdateRemote = false
      break
    default:
      throw new Error(CANCELED_ERROR_MSG)
  }
  return [rules, requiredUpdateLocal, requiredUpdateRemote]
}

const checkRulesEmpty = (rules: string): boolean => !rules.length

export const mergeDislikeFullData = async (
  local: string,
  remote: string,
  getMergeMode: () => Promise<LX.Sync.Dislike.SyncMode>,
  getLocal: () => Promise<string>,
): Promise<[string, boolean, boolean]> => {
  if (checkRulesEmpty(local)) {
    if (checkRulesEmpty(remote)) return [local, false, false]
    return [remote, true, false]
  }
  if (checkRulesEmpty(remote)) return [local, false, true]
  return handleMergeRulesData(remote, getMergeMode, getLocal)
}

export const mergeDislikeFullDataFromSnapshot = (
  local: string,
  latest: string,
  snapshot: string | null,
): string => {
  const removed = new Set<string>()
  const localRules = filterRules(local)
  const latestRules = filterRules(latest)
  if (snapshot) {
    const snapshotRules = filterRules(snapshot)
    for (const r of snapshotRules.values()) {
      if (!localRules.has(r) || !latestRules.has(r)) removed.add(r)
    }
  }
  return Array.from(
    new Set([...localRules, ...latestRules].filter((r) => !removed.has(r))),
  ).join('\n')
}
