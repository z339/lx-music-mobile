import { connectServer } from '@/plugins/sync'
import { updateSetting } from '@/core/common'
import { getSyncHost } from '@/plugins/sync/data'
import { syncNow } from '@/plugins/sync/webdav'


export default async(setting: LX.AppSetting) => {
  // WebDAV 同步：启动时自动拉取一次（写入在「立即同步」手动触发）
  if (setting['sync.type'] == 'webdav') {
    void syncNow()
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
