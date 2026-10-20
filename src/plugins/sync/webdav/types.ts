import { stringMd5 } from 'react-native-quick-md5'

// ============================================================================
// WebDAV 远端数据格式（与 any-listen 桌面端保持一致，便于两端共用同一份数据）
// 注意：移动端本地列表是「平铺」结构（defaultList/loveList 为 MusicInfo[]），
//       而 any-listen 是「嵌套」结构（含 list/meta）。这里定义 any-listen 兼容的
//       远端格式，并在读写时做转换。
// ============================================================================

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  path: string
}

export interface RemoteMusicMeta {
  songId: string | number
  albumName: string | null
  picUrl?: string | null
  toggleMusicInfo?: unknown
  // any-listen 在歌曲级记录的元信息（移动端本地不跟踪，写入时合成默认值）
  updateTime: number
  deviceId: string
  isLocal: boolean
}

export type RemoteMusicInfo = Omit<LX.Music.MusicInfo, 'meta'> & {
  meta: RemoteMusicMeta
}

export interface RemoteListMeta {
  updateTime: number
  syncTime: number
  playCount: number
  songCount: number
  posTime: number
}

export interface RemoteDefaultListInfo {
  id: 'default'
  name: string
  list: RemoteMusicInfo[]
  meta: RemoteListMeta
}
export interface RemoteLoveListInfo {
  id: 'love'
  name: string
  list: RemoteMusicInfo[]
  meta: RemoteListMeta
}
export interface RemoteUserListInfo {
  id: string
  name: string
  source?: LX.OnlineSource
  sourceListId?: string
  locationUpdateTime: number | null
  list: RemoteMusicInfo[]
  meta: RemoteListMeta
}
export type RemoteListInfoFull = RemoteDefaultListInfo | RemoteLoveListInfo | RemoteUserListInfo

export interface RemoteListDataFull {
  defaultList: RemoteDefaultListInfo
  loveList: RemoteLoveListInfo
  userList: RemoteUserListInfo[]
  tempList: RemoteMusicInfo[]
}

// 远端快照元信息（与 any-listen 的 SnapshotInfo 一致）
export interface SnapshotClient {
  snapshotKey: string
  lastSyncTime: number
}
export interface SnapshotInfo {
  version: number
  latest: string
  clients: Record<string, SnapshotClient>
}

// ----------------------------------------------------------------------------
// 本地平铺结构 <-> any-listen 嵌套结构 转换
// ----------------------------------------------------------------------------

const buildMeta = (list: RemoteMusicInfo[] | LX.Music.MusicInfo[], posTime = 0): RemoteListMeta => ({
  updateTime: Date.now(),
  syncTime: 0,
  playCount: 0,
  songCount: list.length,
  posTime,
})

const toRemoteMusic = (m: LX.Music.MusicInfo, deviceId: string): RemoteMusicInfo => ({
  ...m,
  meta: {
    songId: m.meta.songId,
    albumName: m.meta.albumName ?? null,
    picUrl: m.meta.picUrl ?? null,
    toggleMusicInfo: m.meta.toggleMusicInfo,
    updateTime: (m.meta as { updateTime?: number }).updateTime ?? Date.now(),
    deviceId,
    isLocal: false,
  },
})

export const toRemoteListData = (local: LX.Sync.List.ListData, deviceId: string): RemoteListDataFull => ({
  defaultList: {
    id: 'default',
    name: '试听列表',
    list: local.defaultList.map((m) => toRemoteMusic(m, deviceId)),
    meta: buildMeta(local.defaultList),
  },
  loveList: {
    id: 'love',
    name: '我的收藏',
    list: local.loveList.map((m) => toRemoteMusic(m, deviceId)),
    meta: buildMeta(local.loveList),
  },
  userList: local.userList.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    sourceListId: l.sourceListId,
    locationUpdateTime: l.locationUpdateTime,
    list: l.list.map((m) => toRemoteMusic(m, deviceId)),
    meta: buildMeta(l.list, l.locationUpdateTime ?? 0),
  })),
  tempList: [],
})

export const fromRemoteListData = (remote: RemoteListDataFull): LX.Sync.List.ListData => ({
  defaultList: remote.defaultList.list.map((m) => m as unknown as LX.Music.MusicInfo),
  loveList: remote.loveList.list.map((m) => m as unknown as LX.Music.MusicInfo),
  userList: remote.userList.map((l) => ({
    id: l.id,
    name: l.name,
    source: l.source,
    sourceListId: l.sourceListId,
    locationUpdateTime: l.locationUpdateTime ?? null,
    // 远端歌单项是 any-listen 嵌套格式，meta 比移动端本地结构更精简（缺 qualitys/filePath 等）。
    // 这里保留原对象直接存入本地，播放时如需音质信息会按需回源补全。
    list: l.list.map((m) => m as unknown as LX.Music.MusicInfo),
  })),
})

// 内容指纹：必须与 any-listen 的 getListDataMD5(JSON.stringify(data)) 保持一致
export const getListDataMD5 = (data: RemoteListDataFull): string => stringMd5(JSON.stringify(data))

export const getDislikeRulesMD5 = (rules: string): string => stringMd5(rules)
