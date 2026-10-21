import { stringMd5 } from 'react-native-quick-md5'

// ============================================================================
// WebDAV 远端数据格式 —— 严格对齐 any-listen 桌面端（packages/shared/app/modules/sync/webdav）
//
// 关键约束：远端快照的 MD5 = toMD5(JSON.stringify(listData))，
// 而 JSON.stringify 的结果依赖 **键的插入顺序**。
// 因此本文件定义的 RemoteListDataFull 的字段顺序、字段名必须与桌面端完全一致，
// 否则两端算出的 MD5 永远不同，将无法识别对方写入的快照（表现为「每次同步都判定为冲突」）。
//
// 桌面端权威定义：
//   ListDataFull = { defaultList, loveList, userList }   ← 注意：没有 tempList
//   ListInfoFull = { id, name, type, meta, parentId, list }
//   MusicInfo     = { id, name, singer, interval, isLocal, meta }
// ============================================================================

export interface WebDAVConfig {
  url: string
  username: string
  password: string
  path: string
}

// ---------------------------------------------------------------------------
// 歌曲（对齐 any-listen MusicInfo）
// ---------------------------------------------------------------------------

/** 歌曲级 meta（对齐 any-listen MusicInfoMetaBase） */
export interface RemoteMusicMeta {
  musicId: string
  albumName: string
  year?: number
  trackNo?: number | null
  discNo?: number | null
  picUrl?: string | null
  createTime: number
  updateTime: number
  posTime: number
  unparsed?: boolean
  /** 在线歌曲的来源（桌面端 MusicInfoMeta_online.source） */
  source?: string
  /** 本地歌曲所属设备（桌面端 MusicInfoMeta_local.deviceId） */
  deviceId?: string
  [key: string]: unknown
}

/** 对齐 any-listen MusicInfo（isLocal 位于顶层，不在 meta 内） */
export interface RemoteMusicInfo {
  id: string
  name: string
  singer: string
  interval: string | null
  isLocal: boolean
  meta: RemoteMusicMeta
}

// ---------------------------------------------------------------------------
// 歌单（对齐 any-listen ListInfoFull）
// ---------------------------------------------------------------------------

/** 歌单元数据（对齐 any-listen UserListInfoBaseMeta） */
export interface RemoteListMeta {
  songCount: number
  pic: string
  playCount: number
  createTime: number
  updateTime: number
  posTime: number
  desc: string
  /** 桌面端 local/online/remote 歌单额外带有 syncTime */
  syncTime?: number
  [key: string]: unknown
}

export interface RemoteDefaultListInfo {
  id: 'default'
  name: string
  type: 'default'
  meta: RemoteListMeta
  parentId: string | null
  list: RemoteMusicInfo[]
}
export interface RemoteLoveListInfo {
  id: 'love'
  name: string
  type: 'default'
  meta: RemoteListMeta
  parentId: string | null
  list: RemoteMusicInfo[]
}
export interface RemoteUserListInfo {
  id: string
  name: string
  type: string
  meta: RemoteListMeta
  parentId: string | null
  list: RemoteMusicInfo[]
}
export type RemoteListInfoFull = RemoteDefaultListInfo | RemoteLoveListInfo | RemoteUserListInfo

/**
 * 远端完整歌单数据。
 * 字段顺序必须与桌面端一致：defaultList → loveList → userList
 */
export interface RemoteListDataFull {
  defaultList: RemoteDefaultListInfo
  loveList: RemoteLoveListInfo
  userList: RemoteUserListInfo[]
}

// ---------------------------------------------------------------------------
// 快照元信息（对齐 any-listen SnapshotInfo）
// ---------------------------------------------------------------------------

export interface SnapshotClient {
  snapshotKey: string
  lastSyncTime: number
}
export interface SnapshotInfo {
  version: number
  latest: string
  clients: Record<string, SnapshotClient>
}

// ---------------------------------------------------------------------------
// 移动端本地（平铺）结构 <-> 桌面端远端（嵌套）结构 转换
// ---------------------------------------------------------------------------

const buildListMeta = (
  list: RemoteMusicInfo[] | LX.Music.MusicInfo[],
  extra?: Partial<RemoteListMeta>,
): RemoteListMeta => ({
  songCount: list.length,
  pic: '',
  playCount: 0,
  createTime: 0,
  updateTime: Date.now(),
  posTime: 0,
  desc: '',
  ...extra,
})

/**
 * 移动端 MusicInfo → 桌面端 MusicInfo。
 * 移动端 meta 用 songId，桌面端用 musicId；桌面端额外需要顶层 isLocal。
 */
const toRemoteMusic = (m: LX.Music.MusicInfo): RemoteMusicInfo => {
  const isLocal = m.source === 'local'
  const meta = m.meta as unknown as LX.Music.MusicInfoMetaBase & Record<string, unknown>
  const remoteMeta: RemoteMusicMeta = {
    musicId: String(meta.songId ?? ''),
    albumName: meta.albumName ?? '',
    picUrl: meta.picUrl ?? null,
    createTime: 0,
    updateTime: Date.now(),
    posTime: 0,
    unparsed: true,
  }
  if (isLocal) {
    const localMeta = m.meta as LX.Music.MusicInfoMeta_local
    remoteMeta.source = 'local'
    remoteMeta.filePath = localMeta.filePath
    remoteMeta.ext = localMeta.ext
    remoteMeta.deviceId = ''
  } else {
    remoteMeta.source = m.source
  }
  return {
    id: m.id,
    name: m.name,
    singer: m.singer,
    interval: m.interval ?? null,
    isLocal,
    meta: remoteMeta,
  }
}

/**
 * 桌面端 MusicInfo → 移动端 MusicInfo。
 * 桌面端 meta 用 musicId，移动端用 songId；source 字段需还原为移动端的源名。
 */
const fromRemoteMusic = (m: RemoteMusicInfo): LX.Music.MusicInfo => {
  const meta = m.meta
  const musicMeta: LX.Music.MusicInfoMetaBase = {
    songId: meta.musicId,
    albumName: meta.albumName ?? '',
    picUrl: meta.picUrl ?? null,
  }
  if (m.isLocal || meta.source === 'local') {
    return {
      id: m.id,
      name: m.name,
      singer: m.singer,
      source: 'local',
      interval: m.interval ?? null,
      meta: {
        ...musicMeta,
        filePath: (meta.filePath as string) ?? '',
        ext: (meta.ext as string) ?? '',
      },
    } as LX.Music.MusicInfoLocal
  }
  const source = (meta.source || 'kw') as LX.OnlineSource
  return {
    id: m.id,
    name: m.name,
    singer: m.singer,
    source,
    interval: m.interval ?? null,
    meta: {
      ...musicMeta,
      qualitys: [],
      _qualitys: {},
    },
  } as LX.Music.MusicInfoOnline
}

/** 移动端本地歌单数据 → 桌面端远端格式（键顺序严格对齐） */
export const toRemoteListData = (local: LX.Sync.List.ListData): RemoteListDataFull => ({
  defaultList: {
    id: 'default',
    name: '试听列表',
    type: 'default',
    meta: buildListMeta(local.defaultList),
    parentId: null,
    list: local.defaultList.map((m) => toRemoteMusic(m)),
  },
  loveList: {
    id: 'love',
    name: '我的收藏',
    type: 'default',
    meta: buildListMeta(local.loveList),
    parentId: null,
    list: local.loveList.map((m) => toRemoteMusic(m)),
  },
  userList: local.userList.map((l) => ({
    id: l.id,
    name: l.name,
    type: 'general',
    meta: buildListMeta(l.list, { posTime: l.locationUpdateTime ?? 0 }),
    parentId: null,
    list: l.list.map((m) => toRemoteMusic(m)),
  })),
})

/** 桌面端远端格式 → 移动端本地歌单数据 */
export const fromRemoteListData = (remote: RemoteListDataFull): LX.Sync.List.ListData => ({
  defaultList: remote.defaultList.list.map((m) => fromRemoteMusic(m)),
  loveList: remote.loveList.list.map((m) => fromRemoteMusic(m)),
  userList: remote.userList.map((l) => ({
    id: l.id,
    name: l.name,
    source: (l.meta.source as LX.OnlineSource) ?? 'kw',
    sourceListId: (l.meta.sourceListId as string) ?? '',
    locationUpdateTime: l.meta.posTime || null,
    list: l.list.map((m) => fromRemoteMusic(m)),
  })),
})

// 内容指纹：必须与 any-listen 的 getListDataMD5(JSON.stringify(data)) 逐字节一致
export const getListDataMD5 = (data: RemoteListDataFull): string => stringMd5(JSON.stringify(data))

export const getDislikeRulesMD5 = (rules: string): string => stringMd5(rules)
