import { log, logError } from './logger'

export interface WebDAVClientOptions {
  baseUrl: string
  username?: string
  password?: string
}

export interface WebDAVItem {
  path: string
  name: string
  isDir: boolean
}

const fixPath = (path?: string): string => {
  if (!path) return '/'
  if (!path.startsWith('/')) path = `/${path}`
  return path
}

/**
 * UTF-8 字符串 → 字节数组（纯 JS 实现）。
 *
 * 不用 TextEncoder：RN 的 Hermes 引擎并未提供该全局对象
 * （真机报错 `property 'TextEncoder' doesn't exist`），也不能依赖 Buffer。
 */
const utf8ToBytes = (str: string): number[] => {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    // 代理对（emoji 等）需要先转成码点
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const next = str.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = (code - 0xd800) * 0x400 + next - 0xdc00 + 0x10000
        i++
      }
    }
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

/** 字节数组 → Base64（纯 JS，避免依赖 btoa/Buffer） */
const base64FromBytes = (bytes: number[]): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out +=
      chars[b0 >> 2] +
      chars[((b0 & 3) << 4) | (b1 >> 4)] +
      (i + 1 < bytes.length ? chars[((b1 & 15) << 2) | (b2 >> 6)] : '=') +
      (i + 2 < bytes.length ? chars[b2 & 63] : '=')
  }
  return out
}

/** UTF-8 → Base64，用于生成 Basic 认证头 */
const base64FromUtf8 = (str: string): string => base64FromBytes(utf8ToBytes(str))

const parsePropfind = (xml: string): WebDAVItem[] => {
  const items: WebDAVItem[] = []
  // 去除 WebDAV 响应中的命名空间前缀（如 <d:response>、<d:href>），统一为无前缀标签后再解析，
  // 以兼容 Nextcloud、ownCloud、群晖等常见服务器的返回格式。
  const normalized = xml.replace(/<(\/?)[a-zA-Z0-9_-]+:/g, '<$1')
  const responses = normalized.split(/<response>/i).slice(1)
  for (const block of responses) {
    const hrefMatch = block.match(/<href>([\s\S]*?)<\/href>/i)
    if (!hrefMatch) continue
    let href = hrefMatch[1].trim()
    const isDir = /<collection\s*\/?>/i.test(block)
    let rawName = href.endsWith('/') ? href.slice(0, -1) : href
    rawName = rawName.substring(rawName.lastIndexOf('/') + 1)
    const name = decodeURIComponent(rawName)
    items.push({ path: href, name, isDir })
  }
  return items
}

// 轻量 WebDAV 客户端（基于 fetch，兼容 RN）。支持 Basic 认证与
// PROPFIND/GET/PUT/DELETE/MKCOL。连接测试与锁目录列举依赖 ls(PROPFIND)。
export class WebDAVClient {
  private readonly baseUrl: string
  private readonly authHeader?: string

  constructor(options: WebDAVClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    if (options.username) {
      this.authHeader = `Basic ${base64FromUtf8(`${options.username}:${options.password || ''}`)}`
    }
    log('info', `创建 WebDAV 客户端: baseUrl=${this.baseUrl}, 用户名=${options.username || '(无)'}, 密码=${options.password ? '已设置' : '(无)'}`)
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  private getFullUrl(path?: string) {
    return path ? `${this.baseUrl}${path}` : this.baseUrl
  }

  private async request(method: string, path?: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (this.authHeader) headers.Authorization = this.authHeader
    const url = this.getFullUrl(fixPath(path))
    const start = Date.now()
    try {
      const res = await fetch(url, { method: method as never, headers, body: opts.body })
      const status = res.status
      const text = await res.text()
      const cost = Date.now() - start
      if (status > 299) {
        // 404/409 等属于 WebDAV 的正常分支（如探测文件是否存在），记为 warn 且不打印堆栈；
        // 上面的 throw 已在调用方按需处理，此处只记录一次，避免重复噪音。
        log('warn', `${method} ${url} → ${status} (${cost}ms)`)
        const error = new Error(`${status} [${url}]`) as Error & { status?: number }
        error.status = status
        throw error
      }
      log('info', `${method} ${url} → ${status} (${cost}ms)${method == 'PUT' ? ` [${opts.body?.length ?? 0} 字节]` : ''}`)
      return { status, text }
    } catch (err) {
      // 非 HTTP 状态码的错误（网络中断、fetch 失败等）才记 error
      const status = (err as { status?: number }).status
      if (!status) logError(`${method} ${url} 请求失败`, err)
      throw err
    }
  }

  async ls(path = '/'): Promise<WebDAVItem[]> {
    const res = await this.request('PROPFIND', path, { headers: { Depth: '1' } })
    const items = parsePropfind(res.text)
    log('info', `PROPFIND ${path} 解析到 ${items.length} 个条目: ${items.map((i) => i.name + (i.isDir ? '/' : '')).join(', ') || '(空)'}`)
    return items
  }

  async rm(path: string) {
    await this.request('DELETE', path)
  }

  async mkdir(path: string) {
    await this.request('MKCOL', path)
  }

  async get(path: string): Promise<string> {
    const res = await this.request('GET', path)
    return res.text
  }

  async put(path: string, data: string) {
    await this.request('PUT', path, { body: data })
  }
}

export const is404Error = (error: unknown): boolean => error instanceof Error && error.message.startsWith('404')
