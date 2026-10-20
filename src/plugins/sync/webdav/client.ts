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

// UTF-8 -> Base64，避免依赖 RN 不一定存在的全局 Buffer/btoa
const base64FromUtf8 = (str: string): string => {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i)
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0
    out +=
      chars[a >> 2] +
      chars[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < binary.length ? chars[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < binary.length ? chars[c & 63] : '=')
  }
  return out
}

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
  }

  private getFullUrl(path?: string) {
    return path ? `${this.baseUrl}${path}` : this.baseUrl
  }

  private async request(method: string, path?: string, opts: { headers?: Record<string, string>; body?: string } = {}) {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (this.authHeader) headers.Authorization = this.authHeader
    const url = this.getFullUrl(fixPath(path))
    const res = await fetch(url, { method: method as never, headers, body: opts.body })
    const status = res.status
    const text = await res.text()
    if (status > 299) throw new Error(`${status} [${url}]`)
    return { status, text }
  }

  async ls(path = '/'): Promise<WebDAVItem[]> {
    const res = await this.request('PROPFIND', path, { headers: { Depth: '1' } })
    return parsePropfind(res.text)
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
