import { WebDAVClient, is404Error, type WebDAVItem } from './client'
import { log, logError } from './logger'
import { CONSTANTS, generateId } from './shared'
import type { WebDAVConfig } from './types'

// 业务封装：在用户配置的 path 下组织 list/dislike 目录，并提供分布式锁
// （与 any-listen 一致的 lock-<时间戳>-<id> 锁文件），避免多端并发写冲突。
export class WebDAV {
  private readonly client: WebDAVClient
  private lockFileName: string | null = null
  private readonly path: string

  constructor(config: WebDAVConfig) {
    this.path = config.path
    this.client = new WebDAVClient({
      baseUrl: config.url,
      username: config.username,
      password: config.password,
    })
  }

  getClient() {
    return this.client
  }

  async checkConnection(): Promise<Error | null> {
    log('info', `开始测试连接: ${this.client.getBaseUrl()}${this.path ? ` (远程目录: ${this.path})` : ''}`)
    try {
      await this.client.ls()
      log('info', '连接测试成功')
      return null
    } catch (err) {
      logError('连接测试失败', err)
      return err as Error
    }
  }

  async checkCurrentLock(): Promise<boolean> {
    const files = await this.ls()
    return !!files.find((f) => f.name === this.lockFileName)
  }

  async checkLocked(): Promise<boolean> {
    const files = await this.ls()
    const file = files.find((f) => f.name.startsWith(CONSTANTS.lockFilePrefix))
    if (!file) {
      log('info', '未发现同步锁，可以开始同步')
      return false
    }
    const time = parseInt(file.name.replace(CONSTANTS.lockFilePrefix, ''))
    if (isNaN(time)) return false
    if (Date.now() - time > 1000 * 60 * 2) {
      log('warn', `同步锁 ${file.name} 已超过 2 分钟，视为过期并清理`)
      void this.rm(file.name) // 锁超过 2 分钟视为过期，自动清理
      return false
    }
    log('info', `检测到其他设备的同步锁: ${file.name}`)
    return true
  }

  private async handleLock(): Promise<boolean> {
    const now = Date.now()
    const lockFileName = `${CONSTANTS.lockFilePrefix}${now}-${generateId()}`
    log('info', `尝试获取同步锁: ${lockFileName}`)
    await this.put(lockFileName, '')
    const files = await this.ls()
    for (const file of files) {
      if (file.name.startsWith(CONSTANTS.lockFilePrefix) && file.name !== lockFileName) {
        const time = parseInt(file.name.replace(CONSTANTS.lockFilePrefix, ''))
        if (isNaN(time)) continue
        if (now > time) {
          await this.rm(lockFileName)
          return false
        }
      }
    }
    this.lockFileName = lockFileName
    log('info', `已获取同步锁: ${lockFileName}`)
    return true
  }

  // 返回取消函数；加锁成功后通过 onEnd(true) 回调触发同步
  lock(onEnd: (locked: boolean, error?: Error) => void): () => void {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      const locked = await this.checkLocked().catch((err: Error) => {
        onEnd(false, err)
        throw err
      })
      if (locked) {
        // 检测到他人锁，2 秒后重试
        timer = setTimeout(() => {
          timer = null
          void run()
        }, 2000)
        return
      }
      if (cancelled) {
        onEnd(false)
        return
      }
      const ok = await this.handleLock().catch((err: Error) => {
        onEnd(false, err)
        throw err
      })
      if (!ok) {
        onEnd(false)
        return
      }
      if (cancelled) {
        await this.unlock().catch(() => {})
        onEnd(false)
        return
      }
      onEnd(true)
    }
    void run()
    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
        onEnd(false)
      }
    }
  }

  async unlock() {
    log('info', '正在释放同步锁')
    const files = await this.ls()
    const target = files
      .filter((f) => f.name.startsWith(CONSTANTS.lockFilePrefix))
      .find((f) => f.name === this.lockFileName)
    if (target) {
      await this.rm(target.name)
      log('info', `已释放同步锁: ${target.name}`)
    }
  }

  async put(path: string, data: string) {
    return this.client.put(`${this.path}/${path}`, data)
  }

  async rm(path: string) {
    return this.client.rm(`${this.path}/${path}`)
  }

  async get(path: string): Promise<string> {
    return this.client.get(`${this.path}/${path}`)
  }

  async ls(path?: string): Promise<WebDAVItem[]> {
    return this.client.ls(path ? `${this.path}/${path}` : this.path)
  }

  async mkdir(path: string) {
    return this.client.mkdir(`${this.path}/${path}`)
  }
}

export { is404Error } from './client'
