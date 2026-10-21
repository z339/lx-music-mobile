import type { SnapshotInfo } from './types'
import { log } from './logger'

export interface Options<T> {
  getSnapshotInfo: () => Promise<SnapshotInfo | null>
  saveSnapshotInfo: (snapshotInfo: SnapshotInfo) => Promise<void>
  getSnapshotList: () => Promise<string[] | null>
  removeSnapshot: (key: string) => Promise<void>
  saveSnapshotList: (list: string[]) => Promise<void>
  getSnapshotData: (key: string) => Promise<T | null>
  overwriteLocalList: (data: T) => Promise<void>
  saveSnapshotData: (key: string, data: T) => Promise<void>
}

const MAX_SNAPSHOT_NUM = 30

// 快照生命周期管理（与 any-listen 一致）：以内容 MD5 寻址，最多保留 30 个快照，
// 仅清理未被任何设备引用的旧快照。
export class SnapshotDataManage<T> {
  private snapshotInfo: SnapshotInfo = { version: 1, latest: '', clients: {} }
  private snapshotList: string[] = []
  private inited = false

  constructor(
    private readonly options: Options<T>,
    private readonly getMD5: (data: T) => string,
  ) {}

  init = async (snapshotInfo?: SnapshotInfo | null) => {
    if (this.inited) return
    const [info, list] = await Promise.all([
      snapshotInfo ? Promise.resolve(snapshotInfo) : this.options.getSnapshotInfo(),
      this.options.getSnapshotList(),
    ])
    if (info) this.snapshotInfo = info
    if (list) this.snapshotList = list
    this.inited = true
  }

  clearOldSnapshot = async (): Promise<boolean> => {
    await this.init()
    if (this.snapshotList.length <= MAX_SNAPSHOT_NUM) return false
    const excluded = new Set<string>()
    for (const client of Object.values(this.snapshotInfo.clients)) excluded.add(client.snapshotKey)
    const removedKeys: string[] = []
    for (let i = this.snapshotList.length - 1; i > MAX_SNAPSHOT_NUM - 1; i--) {
      const key = this.snapshotList[i]
      if (!excluded.has(key)) {
        removedKeys.push(key)
        this.snapshotList.splice(i, 1)
      }
    }
    if (!removedKeys.length) return false
    log('info', `清理旧快照 ${removedKeys.length} 个`)
    await this.options.saveSnapshotList(this.snapshotList)
    for (const key of removedKeys) await this.options.removeSnapshot(key)
    return true
  }

  saveSnapshotData = async (deviceId: string, data: T): Promise<void> => {
    await this.init()
    const md5 = this.getMD5(data)
    log('info', `保存快照: key=${md5}，设备=${deviceId}`)
    this.snapshotInfo.latest = md5
    this.snapshotInfo.clients[deviceId] = { snapshotKey: md5, lastSyncTime: Date.now() }
    const idx = this.snapshotList.indexOf(md5)
    if (idx == -1) await this.options.saveSnapshotData(md5, data)
    else this.snapshotList.splice(idx, 1)
    await this.options.saveSnapshotInfo(this.snapshotInfo)
    this.snapshotList.unshift(md5)
    const updated = await this.clearOldSnapshot()
    if (!updated) await this.options.saveSnapshotList(this.snapshotList)
  }
}
