import settingState from '@/store/setting/state'
import { setSyncStatus, setSyncMessage, selectSyncMode } from '@/core/sync'
import { WebDAV } from './webdav'
import { initDeviceId } from './shared'
import { runSync } from './modules'
import type { WebDAVConfig } from './types'

export type { WebDAVConfig } from './types'

export const getWebDavConfig = (): WebDAVConfig => {
  const s = settingState.setting
  return {
    url: s['sync.webdav.url'],
    username: s['sync.webdav.username'],
    password: s['sync.webdav.password'],
    path: s['sync.webdav.path'],
  }
}

// 返回 Error 表示连接失败（含原因），null 表示成功
export const testConnection = async (config: WebDAVConfig): Promise<Error | null> => {
  const webDAV = new WebDAV(config)
  return webDAV.checkConnection()
}

// 立即同步：测试连接 -> 加锁 -> 歌单+不喜欢 三方合并
export const syncNow = async (): Promise<void> => {
  const config = getWebDavConfig()
  if (!config.url) {
    setSyncMessage('setting_sync_webdav_url_empty')
    return
  }
  await initDeviceId()
  const webDAV = new WebDAV(config)
  const err = await webDAV.checkConnection()
  if (err) {
    setSyncStatus({ status: false, message: `连接失败：${err.message}` })
    return
  }
  setSyncStatus({ status: true, message: 'setting_sync_webdav_syncing' })
  webDAV.lock((locked, error) => {
    if (error) {
      setSyncStatus({ status: false, message: error.message })
      return
    }
    if (!locked) {
      setSyncStatus({ status: false, message: '' })
      return
    }
    runSync(webDAV, {
      onEnd: (e) => {
        setSyncStatus({ status: false, message: e ? `同步失败：${e.message}` : 'setting_sync_webdav_sync_success' })
        void webDAV.unlock()
      },
      getListMergeMode: () => selectSyncMode(config.url, 'list') as Promise<LX.Sync.List.SyncMode>,
      getDislikeMergeMode: () => selectSyncMode(config.url, 'dislike') as Promise<LX.Sync.Dislike.SyncMode>,
    })
  })
}
