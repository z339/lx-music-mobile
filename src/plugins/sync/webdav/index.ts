import settingState from '@/store/setting/state'
import { setSyncStatus, setSyncMessage, selectSyncMode } from '@/core/sync'
import { updateSetting } from '@/core/common'
import { WebDAV } from './webdav'
import { initDeviceId } from './shared'
import { runSync, runSyncList, runSyncDislike, runSyncUserApi } from './modules'
import type { WebDAVConfig } from './types'
import { log, logError } from './logger'

export type { WebDAVConfig } from './types'

/** 同步结果类型 */
export interface SyncResult {
  /** 是否同步成功 */
  success: boolean
  /** 错误信息（失败时） */
  error?: string
  /** 实际执行的任务 */
  tasks: SyncTask[]
}

export type SyncTask = 'list' | 'dislike' | 'userapi'

/** 要同步的内容选项 */
export interface SyncContentOptions {
  /** 同步歌曲列表 */
  list: boolean
  /** 同步「不喜欢」规则 */
  dislike: boolean
  /** 同步音源（自定义源） */
  userApi: boolean
}

export const getWebDavConfig = (): WebDAVConfig => {
  const s = settingState.setting
  return {
    url: s['sync.webdav.url'],
    username: s['sync.webdav.username'],
    password: s['sync.webdav.password'],
    path: s['sync.webdav.path'],
  }
}

export const getSyncOptions = (): SyncContentOptions => {
  const s = settingState.setting
  return {
    list: s['sync.webdav.syncList'],
    dislike: s['sync.webdav.syncDislike'],
    userApi: s['sync.webdav.syncUserApi'],
  }
}

export const getLastSyncTime = (): number => settingState.setting['sync.webdav.lastSyncTime']

// 返回 Error 表示连接失败（含原因），null 表示成功
export const testConnection = async (config: WebDAVConfig): Promise<Error | null> => {
  const webDAV = new WebDAV(config)
  return webDAV.checkConnection()
}

/**
 * 立即同步。
 *
 * 流程：校验配置 -> 测试连接 -> 加锁 -> 按选项执行歌单/不喜欢同步 -> 解锁。
 * 无论成功失败都会 resolve（不 reject），错误信息通过 SyncResult.error 返回，
 * 便于 UI 统一展示；仅在「配置无效」时也以 failed 结果返回。
 */
export const syncNow = async (options?: Partial<SyncContentOptions>): Promise<SyncResult> => {
  const config = getWebDavConfig()
  const defaults = getSyncOptions()
  const opts: SyncContentOptions = {
    list: options?.list ?? defaults.list,
    dislike: options?.dislike ?? defaults.dislike,
    userApi: options?.userApi ?? defaults.userApi,
  }
  const tasks: SyncTask[] = []
  if (opts.list) tasks.push('list')
  if (opts.dislike) tasks.push('dislike')
  if (opts.userApi) tasks.push('userapi')

  const fail = (error: string): SyncResult => {
    setSyncStatus({ status: false, message: error })
    return { success: false, error, tasks }
  }

  log('info', `开始同步：任务=[${tasks.join(', ') || '无'}]，地址=${config.url || '(空)'}，远程目录=${config.path || '(根目录)'}`)
  if (!config.url) return fail('setting_sync_webdav_url_empty')
  if (!tasks.length) return fail('setting_sync_webdav_no_task')

  await initDeviceId()
  const webDAV = new WebDAV(config)

  setSyncStatus({ status: true, message: 'setting_sync_webdav_syncing' })

  const err = await webDAV.checkConnection()
  if (err) {
    logError('同步前连接检查失败', err)
    return fail(`setting_sync_webdav_connect_fail|${err.message}`)
  }

  return new Promise<SyncResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (result: SyncResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(result)
    }

    const cancelLock = webDAV.lock((locked, error) => {
      if (error) {
        logError('获取同步锁出错', error)
        finish(fail(`setting_sync_webdav_lock_fail|${error.message}`))
        return
      }
      if (!locked) {
        // 锁被其他设备占用或用户取消
        log('warn', '未获得同步锁（其他设备正在同步或已取消）')
        finish(fail('setting_sync_webdav_lock_busy'))
        return
      }

      const onEnd = (e?: Error) => {
        void webDAV.unlock()
        if (e) {
          logError('同步执行失败', e)
          finish(fail(`setting_sync_webdav_sync_fail|${e.message}`))
          return
        }
        const time = Date.now()
        log('info', `同步完成，任务=[${tasks.join(', ')}]`)
        updateSetting({ 'sync.webdav.lastSyncTime': time })
        setSyncStatus({ status: false, message: 'setting_sync_webdav_sync_success' })
        finish({ success: true, tasks })
      }

      // 按用户选项只执行需要的任务
      if (tasks.length === 1 && tasks[0] == 'userapi') {
        // 音源同步无需选择合并方式
        runSyncUserApi(webDAV).then(() => onEnd()).catch((err2: Error) => onEnd(err2))
        return
      }

      if (tasks.length === 1) {
        const task = tasks[0]
        const getMode = task === 'list'
          ? () => selectSyncMode(config.url, 'list') as Promise<LX.Sync.List.SyncMode>
          : () => selectSyncMode(config.url, 'dislike') as Promise<LX.Sync.Dislike.SyncMode>
        // 与 runSync 保持一致：选定合并模式后校验锁仍存在
        const wrapped = async (): Promise<LX.Sync.List.SyncMode | LX.Sync.Dislike.SyncMode> => {
          const mode = await getMode()
          if (mode !== 'cancel' && !(await webDAV.checkCurrentLock())) {
            throw new Error('Lock file is missing, sync cancelled')
          }
          return mode
        }
        const runTask = task === 'list'
          ? runSyncList(webDAV, wrapped as () => Promise<LX.Sync.List.SyncMode>)
          : runSyncDislike(webDAV, wrapped as () => Promise<LX.Sync.Dislike.SyncMode>)
        runTask.then(() => onEnd()).catch((err2: Error) => onEnd(err2))
        return
      }

      runSync(webDAV, {
        onEnd,
        syncUserApi: opts.userApi,
        getListMergeMode: () => selectSyncMode(config.url, 'list') as Promise<LX.Sync.List.SyncMode>,
        getDislikeMergeMode: () => selectSyncMode(config.url, 'dislike') as Promise<LX.Sync.Dislike.SyncMode>,
      })
    })

    // 锁超时保护：10 分钟仍未结束则强制结束，避免界面一直转圈
    timer = setTimeout(() => {
      if (settled) return
      log('error', '同步超时（超过 10 分钟），强制结束')
      cancelLock()
      finish(fail('setting_sync_webdav_timeout'))
    }, 10 * 60 * 1000)
  })
}

/** 取消当前同步 */
export const cancelSync = async (): Promise<void> => {
  setSyncMessage('')
  setSyncStatus({ status: false, message: '' })
}
