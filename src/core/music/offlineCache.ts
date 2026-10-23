/**
 * 离线缓存（Offline Cache）
 * ----------------------------------------------------------------------------
 * 与「播放器流式缓冲缓存」（DocumentDir/TrackPlayer，由 player.cacheSize 管理）、
 * 「@music_url__ / @lyric__ KV 缓存」、原生 OS 图片/歌词缓存（getCacheDir）完全隔离：
 *   - 文件存放在 DocumentDir/OfflineCache 新目录；
 *   - 索引存放在独立 KV 前缀 @offline_cache__。
 * 因此不会与现有任何缓存机制冲突。
 *
 * 设计要点：
 *   - 按 `${source}__${songId}` 建索引键，单个歌曲只保留一个音质文件（缓存时覆盖）。
 *   - 每条记录维护 `listIds`（引用它的音乐列表）与 `pinned`（用户显式固定）两个维度：
 *       * 来自「列表的缓存操作」（单首/批量/整个列表）会写入对应 listId；
 *       * 用户从播放器/管理页「显式缓存」的单曲为 pinned=true，移除列表不删；
 *       * 自动收集（听完整首后）为 pinned=false，不绑定列表。
 *   - 移除列表内单曲 / 移除整个列表 / 清空列表时，移除对应引用；当某记录引用清空且非
 *     pinned 时，自动删除其缓存文件（满足「列表移除同步清除缓存」）。
 *   - 自动收集：在线歌曲开始播放时，在后台把它下载进离线缓存（仅一次）。
 */

import { downloadFile, existsFile, unlink, mkdir, stat, privateStorageDirectoryPath } from '@/utils/fs'
import { getData, saveData } from '@/plugins/storage'
import { storageDataPrefix } from '@/config/constant'
import { getMusicUrl as getOnlineMusicUrl } from './online'
import { getPlayQuality } from './utils'
import settingState from '@/store/setting/state'

const OFFLINE_CACHE_DIR = `${privateStorageDirectoryPath}/OfflineCache`

/** 自动收集开关（听完整首后自动入离线缓存）。默认开启。 */
const AUTO_COLLECT_ENABLED = true

export interface OfflineCacheItem {
  /** 歌曲 id（musicInfo.id） */
  id: string
  /** 音源，如 wy / kw / user_api_xxx */
  source: string
  name: string
  singer: string
  quality: LX.Quality
  ext: string
  /** 绝对文件路径 */
  filePath: string
  /** 字节大小 */
  size: number
  /** 引用该歌曲的音乐列表 id（用于列表移除时清理） */
  listIds: string[]
  /** 用户显式固定缓存（移除列表时不被删除） */
  pinned: boolean
  createTime: number
}

const cacheKey = (source: string, id: string) => `${source}__${id}`

const sanitize = (s: string) => s.replace(/[\\/]/g, '_')

const parseExt = (url: string): string => {
  try {
    const path = url.split('?')[0].split('#')[0]
    const m = path.match(/\.([a-z0-9]{1,4})$/i)
    if (m) return m[1].toLowerCase()
  } catch { /* ignore */ }
  return 'mp3'
}

const buildFilePath = (source: string, id: string, quality: string, ext: string) =>
  `${OFFLINE_CACHE_DIR}/${sanitize(source)}_${sanitize(id)}_${quality}.${ext}`

let cacheMap = new Map<string, OfflineCacheItem>()
let inFlight = new Set<string>()
let initialized = false

const saveIndex = async() => {
  await saveData(storageDataPrefix.offlineCache, Object.fromEntries(cacheMap))
}

export const initOfflineCache = async(): Promise<void> => {
  if (initialized) return
  initialized = true
  await loadIndex()
  registerListEventCleanup()
}

const loadIndex = async() => {
  const data = await getData<Record<string, OfflineCacheItem>>(storageDataPrefix.offlineCache)
  cacheMap = new Map(Object.entries(data ?? {}))
  // 清理索引中文件已丢失的条目，保证索引与磁盘一致
  const stale: string[] = []
  for (const [key, item] of cacheMap) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await existsFile(item.filePath))) stale.push(key)
  }
  for (const key of stale) cacheMap.delete(key)
  if (stale.length) await saveIndex()
}

// ----------------------------------------------------------------------------
// 查询
// ----------------------------------------------------------------------------

/** 取得某首歌的离线缓存记录（若存在且文件仍在） */
export const getCacheItem = async(source: string, id: string): Promise<OfflineCacheItem | null> => {
  const item = cacheMap.get(cacheKey(source, id))
  if (!item) return null
  if (!(await existsFile(item.filePath))) {
    cacheMap.delete(cacheKey(source, id))
    void saveIndex()
    return null
  }
  return item
}

/**
 * 返回可用于播放的离线文件路径（file:// URI）；无缓存返回 null。
 * 播放链路（core/music/index.ts）在无网络或希望离线播放时会优先使用它。
 * 当离线缓存功能关闭（common.isEnableOfflineCache=false）时，返回 null，
 * 强制走在线播放，避免影响原音乐的正常播放。
 */
export const getCacheFilePath = async(musicInfo: LX.Music.MusicInfo): Promise<string | null> => {
  if (!settingState.setting['common.isEnableOfflineCache']) return null
  const item = await getCacheItem(musicInfo.source, musicInfo.id)
  return item ? `file://${item.filePath}` : null
}

/** 是否已缓存 */
export const isCached = async(musicInfo: LX.Music.MusicInfo): Promise<boolean> =>
  (await getCacheItem(musicInfo.source, musicInfo.id)) != null

/** 缓存列表（按缓存时间倒序） */
export const getCacheList = async(): Promise<OfflineCacheItem[]> =>
  [...cacheMap.values()].sort((a, b) => b.createTime - a.createTime)

/** 搜索（按歌名/歌手，大小写不敏感） */
export const searchCache = async(keyword: string): Promise<OfflineCacheItem[]> => {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return getCacheList()
  return (await getCacheList()).filter(
    (i) => i.name.toLowerCase().includes(kw) || i.singer.toLowerCase().includes(kw),
  )
}

// ----------------------------------------------------------------------------
// 写入 / 删除
// ----------------------------------------------------------------------------

export interface CacheOptions {
  /** 目标音质，缺省取播放设置 */
  quality?: LX.Quality
  /** 触发缓存的来源列表 id（用于引用计数清理） */
  listId?: string
  /** 是否固定（用户显式缓存，移除列表不删） */
  pinned?: boolean
}

const downloadToCache = async(musicInfo: LX.Music.MusicInfo, opts: CacheOptions): Promise<OfflineCacheItem> => {
  const quality = opts.quality ?? getPlayQuality(settingState.setting['player.playQuality'], musicInfo as LX.Music.MusicInfoOnline)
  const url = await getOnlineMusicUrl({
    musicInfo: musicInfo as LX.Music.MusicInfoOnline,
    quality,
    isRefresh: true,
    allowToggleSource: true,
  })
  if (!/^https?:\/\//.test(url)) throw new Error('无效的播放链接')

  const ext = parseExt(url)
  const filePath = buildFilePath(musicInfo.source, musicInfo.id, quality as string, ext)
  // 若之前以不同音质/扩展名缓存过，清理旧文件，避免残留
  const prev = cacheMap.get(cacheKey(musicInfo.source, musicInfo.id))
  if (prev && prev.filePath !== filePath) {
    try { await unlink(prev.filePath) } catch { /* ignore */ }
  }
  await mkdir(OFFLINE_CACHE_DIR)
  const dl = downloadFile(url, filePath)
  const res = await dl.promise
  if (res.statusCode >= 400 || res.bytesWritten === 0) {
    try { await unlink(filePath) } catch { /* ignore */ }
    throw new Error(`下载失败，状态码 ${res.statusCode}`)
  }
  let size = res.bytesWritten
  try {
    const st = await stat(filePath)
    if (st?.size) size = st.size
  } catch { /* ignore */ }

  const item: OfflineCacheItem = {
    id: musicInfo.id,
    source: musicInfo.source,
    name: musicInfo.name,
    singer: musicInfo.singer,
    quality,
    ext,
    filePath,
    size,
    listIds: opts.listId ? [opts.listId] : [],
    pinned: !!opts.pinned,
    createTime: Date.now(),
  }
  cacheMap.set(cacheKey(musicInfo.source, musicInfo.id), item)
  await saveIndex()
  return item
}

/** 缓存单首歌曲，返回最新缓存记录。已缓存则仅更新引用/固定状态。 */
export const cacheMusic = async(musicInfo: LX.Music.MusicInfo, opts: CacheOptions = {}): Promise<OfflineCacheItem> => {
  const key = cacheKey(musicInfo.source, musicInfo.id)
  const existing = cacheMap.get(key)
  if (existing && (await existsFile(existing.filePath))) {
    if (opts.listId && !existing.listIds.includes(opts.listId)) existing.listIds.push(opts.listId)
    if (opts.pinned) existing.pinned = true
    await saveIndex()
    return existing
  }
  return downloadToCache(musicInfo, opts)
}

export interface BatchResult {
  success: Array<{ musicInfo: LX.Music.MusicInfo, item: OfflineCacheItem }>
  failed: Array<{ musicInfo: LX.Music.MusicInfo, error: string }>
}

/** 批量缓存（顺序执行，适合「批量」与「整个列表」操作） */
export const cacheMusics = async(musicInfos: LX.Music.MusicInfo[], opts: CacheOptions = {}): Promise<BatchResult> => {
  const result: BatchResult = { success: [], failed: [] }
  for (const musicInfo of musicInfos) {
    try {
      const item = await cacheMusic(musicInfo, opts)
      result.success.push({ musicInfo, item })
    } catch (err) {
      result.failed.push({ musicInfo, error: (err as Error).message ?? String(err) })
    }
  }
  return result
}

const forgetCacheItem = async(source: string, id: string) => {
  const key = cacheKey(source, id)
  const item = cacheMap.get(key)
  if (!item) return
  try { await unlink(item.filePath) } catch { /* ignore */ }
  cacheMap.delete(key)
  await saveIndex()
}

/** 删除单首缓存（只需 source + id） */
export const removeCache = async(target: { source: string, id: string }): Promise<void> => {
  await forgetCacheItem(target.source, target.id)
}

/** 批量删除 */
export const removeCaches = async(targets: Array<{ source: string, id: string }>): Promise<void> => {
  for (const t of targets) await forgetCacheItem(t.source, t.id)
}

/** 清空全部离线缓存 */
export const clearAllCache = async(): Promise<void> => {
  for (const item of cacheMap.values()) {
    try { await unlink(item.filePath) } catch { /* ignore */ }
  }
  cacheMap = new Map()
  await saveIndex()
}

/** 统计信息（数量 + 总大小） */
export const getCacheStat = async(): Promise<{ count: number, size: number }> => {
  let size = 0
  for (const item of cacheMap.values()) size += item.size
  return { count: cacheMap.size, size }
}

// ----------------------------------------------------------------------------
// 引用计数清理（与音乐列表联动）
// ----------------------------------------------------------------------------

const removeListRef = async(source: string, id: string, listId: string) => {
  const item = cacheMap.get(cacheKey(source, id))
  if (!item) return
  item.listIds = item.listIds.filter((l) => l != listId)
  if (item.listIds.length === 0 && !item.pinned) {
    await forgetCacheItem(source, id)
  } else {
    await saveIndex()
  }
}

const removeListRefsForIds = async(listIds: string[]) => {
  const set = new Set(listIds)
  let changed = false
  for (const item of [...cacheMap.values()]) {
    if (!item.listIds.some((l) => set.has(l))) continue
    item.listIds = item.listIds.filter((l) => !set.has(l))
    if (item.listIds.length === 0 && !item.pinned) {
      await forgetCacheItem(item.source, item.id)
    } else {
      changed = true
    }
  }
  if (changed) await saveIndex()
}

/** 移除列表内若干单曲时清理（ids 为歌曲 id 列表） */
export const handleListMusicRemove = async(listId: string, ids: string[]): Promise<void> => {
  const idSet = new Set(ids)
  for (const item of [...cacheMap.values()]) {
    if (idSet.has(item.id)) await removeListRef(item.source, item.id, listId)
  }
}

/** 移除整个列表 / 清空列表 时清理 */
export const handleListRemoveOrClear = async(listIds: string[]): Promise<void> => {
  await removeListRefsForIds(listIds)
}

/**
 * 清理引用了「已不存在列表」的缓存条目（用于同步覆盖列表等边界场景）。
 * 传入当前仍存在的全部列表 id 集合。
 */
export const pruneOrphanedRefs = async(validListIds: Set<string>): Promise<void> => {
  let changed = false
  for (const item of [...cacheMap.values()]) {
    const orphaned = item.listIds.filter((l) => !validListIds.has(l))
    if (!orphaned.length) continue
    item.listIds = item.listIds.filter((l) => validListIds.has(l))
    if (item.listIds.length === 0 && !item.pinned) {
      await forgetCacheItem(item.source, item.id)
    } else {
      changed = true
    }
  }
  if (changed) await saveIndex()
}

const registerListEventCleanup = () => {
  const ev = global.list_event
  if (!ev) return
  ev.on('list_music_remove', async(listId: string, ids: string[]) => {
    await handleListMusicRemove(listId, ids)
  })
  ev.on('list_remove', async(ids: string[]) => {
    await handleListRemoveOrClear(ids)
  })
  ev.on('list_music_clear', async(ids: string[]) => {
    await handleListRemoveOrClear(ids)
  })
}

// ----------------------------------------------------------------------------
// 自动收集（听完整首后自动入离线缓存）
// ----------------------------------------------------------------------------

/**
 * 在线歌曲开始播放时调用：在后台把它下载进离线缓存（仅一次，best-effort）。
 * @param musicInfo 当前播放的在线歌曲
 * @param url 已经取得的播放链接（直接复用，避免重复请求）
 */
export const autoCollectOnPlay = async(musicInfo: LX.Music.MusicInfo, url: string): Promise<void> => {
  if (!AUTO_COLLECT_ENABLED) return
  // 离线缓存功能关闭时，不进行后台自动收集，保持纯在线播放
  if (!settingState.setting['common.isEnableOfflineCache']) return
  if (musicInfo.source == 'local') return
  if (!/^https?:\/\//.test(url)) return
  const key = cacheKey(musicInfo.source, musicInfo.id)
  if (cacheMap.has(key)) return
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    const ext = parseExt(url)
    const quality = getPlayQuality(settingState.setting['player.playQuality'], musicInfo)
    const filePath = buildFilePath(musicInfo.source, musicInfo.id, quality as string, ext)
    await mkdir(OFFLINE_CACHE_DIR)
    const dl = downloadFile(url, filePath)
    const res = await dl.promise
    if (res.statusCode >= 400 || res.bytesWritten === 0) {
      try { await unlink(filePath) } catch { /* ignore */ }
      return
    }
    let size = res.bytesWritten
    try {
      const st = await stat(filePath)
      if (st?.size) size = st.size
    } catch { /* ignore */ }
    cacheMap.set(key, {
      id: musicInfo.id,
      source: musicInfo.source,
      name: musicInfo.name,
      singer: musicInfo.singer,
      quality,
      ext,
      filePath,
      size,
      listIds: [],
      pinned: false,
      createTime: Date.now(),
    })
    await saveIndex()
  } catch {
    // 自动收集为尽力而为，失败静默忽略
  } finally {
    inFlight.delete(key)
  }
}
