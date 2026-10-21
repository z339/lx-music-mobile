import settingState from '@/store/setting/state'

// ============================================================================
// WebDAV 调试日志
//
// 用于排查 WebDAV 同步问题：记录初始化、连接、目录操作、文件读写、快照保存、
// 合并、错误等关键节点。支持：
//   - 开关控制（sync.webdav.debugEnable），关闭时不记录任何内容，零开销
//   - 环形缓冲，最多保留 MAX_LOG_COUNT 条，避免内存无限增长
//   - 清空、一键复制、导出 txt
// ============================================================================

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  time: number
  level: LogLevel
  message: string
}

const MAX_LOG_COUNT = 500

let logs: LogEntry[] = []
let seq = 0
// 日志变更通知（由 UI 订阅）
let notify: (() => void) | null = null

const isEnabled = (): boolean => {
  try {
    return settingState.setting['sync.webdav.debugEnable']
  } catch {
    return false
  }
}

const formatTime = (time: number): string => {
  const d = new Date(time)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${`${d.getMilliseconds()}`.padStart(3, '0')}`
}

/**
 * 写一条调试日志。
 * 关闭调试开关时直接返回，不做任何字符串拼接（保证零开销）。
 */
export const log = (level: LogLevel, message: string, ...args: unknown[]): void => {
  if (!isEnabled()) return
  let text = message
  if (args.length) {
    const extra = args.map((a) => {
      if (a instanceof Error) return `${a.message}${a.stack ? `\n${a.stack}` : ''}`
      if (typeof a == 'object' && a != null) {
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      }
      return String(a)
    }).join(' ')
    text = `${message} ${extra}`
  }
  const entry: LogEntry = { id: ++seq, time: Date.now(), level, message: text }
  logs.push(entry)
  if (logs.length > MAX_LOG_COUNT) logs.splice(0, logs.length - MAX_LOG_COUNT)
  notify?.()
}

/** 记录错误（自动捕获 Error 对象） */
export const logError = (message: string, error?: unknown): void => {
  if (!isEnabled()) return
  if (error instanceof Error) log('error', message, error)
  else if (error != null) log('error', message, error)
  else log('error', message)
}

export const getLogs = (): LogEntry[] => logs

export const clearLogs = (): void => {
  logs = []
  notify?.()
}

/** 导出为纯文本 */
export const formatLogs = (): string => {
  if (!logs.length) return ''
  return logs.map((l) => `[${formatTime(l.time)}] [${l.level.toUpperCase()}] ${l.message}`).join('\n')
}

/**
 * 订阅日志变化，返回取消订阅函数。
 * 供 UI 实时刷新日志列表。
 */
export const subscribeLogs = (cb: () => void): (() => void) => {
  notify = cb
  return () => {
    if (notify === cb) notify = null
  }
}

/** 导出日志到文件（txt），返回文件路径 */
export const exportLogs = async (dirPath: string): Promise<string> => {
  const { writeFile } = await import('@/utils/fs')
  const content = formatLogs()
  const d = new Date()
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const name = `webdav-debug-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.txt`
  const filePath = `${dirPath}/${name}`
  await writeFile(filePath, content || '(empty)', 'utf8')
  return filePath
}
