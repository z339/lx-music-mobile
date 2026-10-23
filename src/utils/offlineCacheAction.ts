import { cacheMusic, cacheMusics, removeCache } from '@/core/music/offlineCache'
import { toast } from '@/utils/tools'

/**
 * 离线缓存相关 UI 操作封装（仅调用 backend 的 @/core/music/offlineCache，
 * 这里只负责统一的 toast 反馈，便于各歌单菜单复用）。
 */

export const handleCacheSong = async(musicInfo: LX.Music.MusicInfo, listId?: string): Promise<void> => {
  try {
    // 来自列表的缓存随列表移除而清理；无列表的单独缓存则固定保留
    await cacheMusic(musicInfo, { listId, pinned: !listId })
    toast(global.i18n.t('offline_cache_cache_success'))
  } catch (err) {
    toast(global.i18n.t('offline_cache_cache_fail', { msg: (err as Error).message ?? String(err) }))
  }
}

export const handleRemoveSongCache = async(musicInfo: LX.Music.MusicInfo): Promise<void> => {
  await removeCache({ source: musicInfo.source, id: musicInfo.id })
  toast(global.i18n.t('offline_cache_deleted'))
}

export const handleCacheList = async(musicInfos: LX.Music.MusicInfo[], listId?: string): Promise<void> => {
  if (!musicInfos.length) {
    toast(global.i18n.t('offline_cache_empty'))
    return
  }
  toast(global.i18n.t('offline_cache_caching'))
  try {
    const result = await cacheMusics(musicInfos, { listId, pinned: !listId })
    toast(global.i18n.t('offline_cache_cache_list_done', { success: result.success.length, failed: result.failed.length }))
  } catch (err) {
    toast(global.i18n.t('offline_cache_cache_fail', { msg: (err as Error).message ?? String(err) }))
  }
}
