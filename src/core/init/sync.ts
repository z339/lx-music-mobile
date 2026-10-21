import { connectServer } from '@/plugins/sync'
import { updateSetting } from '@/core/common'
import { getSyncHost } from '@/plugins/sync/data'
import { syncNow } from '@/plugins/sync/webdav'


export default async(setting: LX.AppSetting) => {
  // WebDAV 同步：启动时自动拉取一次（用户也可在「立即同步」手动触发）
  if (setting['sync.type'] == 'webdav') {
    // 启动阶段静默执行：失败只记录状态，不打断用户（错误可在设置页手动同步时查看）
    void syncNow().then((result) => {
      if (!result.success) console.log('WebDAV auto sync failed:', result.error)
    })
    return
  }

  if (!setting['sync.enable']) return

  const host = await getSyncHost()
  // console.log(host)
  if (!host) {
    updateSetting({ 'sync.enable': false })
    return
  }
  void connectServer(host)
}
