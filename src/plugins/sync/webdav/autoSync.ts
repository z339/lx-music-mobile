import { AppState, type AppStateStatus } from 'react-native'
import settingState from '@/store/setting/state'
import { syncNow } from './index'
import { log } from './logger'

// ============================================================================
// WebDAV 自动同步调度
//
// 设计要点：移动端不能只依赖 setInterval —— App 退到后台后 JS 定时器会被节流/冻结，
// 计时不可靠。因此这里以「AppState 回到前台」为主触发时机，用 setInterval 仅作
// 前台停留时的兜底，两者共用同一套「是否该同步」判定，重复触发由 running 标记防重入。
// ============================================================================

/** 可选的同步间隔（毫秒），0 表示关闭自动同步 */
export const SYNC_INTERVALS = {
  0: 0,
  HOUR_1: 60 * 60 * 1000,
  HOUR_6: 6 * 60 * 60 * 1000,
  DAY_1: 24 * 60 * 60 * 1000,
  WEEK_1: 7 * 24 * 60 * 60 * 1000,
} as const

export type SyncInterval = keyof typeof SYNC_INTERVALS

const getInterval = (): number => {
  try {
    const value = settingState.setting['sync.webdav.interval']
    // 设置里存的是毫秒数；仅当与某个预设间隔一致时才视为有效，
    // 避免脏数据（如手改配置）导致索引异常
    for (const key of Object.keys(SYNC_INTERVALS) as SyncInterval[]) {
      if (SYNC_INTERVALS[key] === value) return value
    }
    return 0
  } catch {
    return 0
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let appStateSub: { remove: () => void } | null = null
let started = false
// 防止手动同步与自动同步并发
let running = false

const isWebDAVEnabled = (): boolean => {
  try {
    const s = settingState.setting
    return s['sync.type'] == 'webdav' && !!s['sync.webdav.url']
  } catch {
    return false
  }
}

/** 是否已到达下次同步时间 */
export const isDue = (): boolean => {
  const interval = getInterval()
  if (!interval) return false
  const last = settingState.setting['sync.webdav.lastSyncTime'] ?? 0
  // 从未同步过则立即同步一次
  if (!last) return true
  return Date.now() - last >= interval
}

/** 距离下次同步还有多久（毫秒）；未开启自动同步返回 -1 */
export const getNextSyncDelay = (): number => {
  const interval = getInterval()
  if (!interval) return -1
  const last = settingState.setting['sync.webdav.lastSyncTime'] ?? 0
  if (!last) return 0
  return Math.max(0, last + interval - Date.now())
}

/** 执行一次自动同步（内部防重入） */
export const runAutoSync = async (): Promise<void> => {
  if (running) return
  const interval = getInterval()
  if (!interval) return
  if (!isWebDAVEnabled()) {
    log('info', '自动同步跳过：未启用 WebDAV 或地址为空')
    return
  }
  if (!isDue()) return

  running = true
  log('info', '到达自动同步时间，开始执行')
  try {
    const result = await syncNow()
    if (result.success) log('info', '自动同步完成')
    else log('info', `自动同步失败：${result.error ?? '未知错误'}`)
  } catch (err) {
    log('info', `自动同步异常：${(err as Error).message}`)
  } finally {
    running = false
  }
}

const checkAndRun = () => {
  void runAutoSync()
}

const startTimer = () => {
  stopTimer()
  // 兜底：前台每 5 分钟检查一次是否到期（后台会被节流，但回到前台会立即触发一次）
  timer = setInterval(checkAndRun, 5 * 60 * 1000)
}

const stopTimer = () => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** 启动调度（App 启动时调用一次） */
export const startAutoSync = (): void => {
  if (started) return
  started = true

  // 回到前台时立即检查一次（这是最可靠的触发时机）
  appStateSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') {
      log('info', '应用回到前台，检查自动同步')
      checkAndRun()
    }
  })

  if (getInterval()) {
    startTimer()
    // 启动时也检查一次
    checkAndRun()
  }

  log('info', '自动同步调度已启动')
}

/** 停止调度（关闭自动同步时调用） */
export const stopAutoSync = (): void => {
  stopTimer()
  if (appStateSub) {
    appStateSub.remove()
    appStateSub = null
  }
  // 不复位 started，便于用户重新开启时复用同一个 AppState 订阅
}

/**
 * 设置变更后调用：开关或间隔改变时重新调度。
 * 关闭时停止定时器，开启时恢复。
 */
export const refreshAutoSync = (): void => {
  if (!started) {
    startAutoSync()
    return
  }
  if (getInterval()) {
    startTimer()
    checkAndRun()
  } else {
    stopTimer()
    log('info', '自动同步已关闭')
  }
}

/** 当前是否处于同步中（供 UI 禁用按钮） */
export const isAutoSyncing = (): boolean => running