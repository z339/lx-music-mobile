import { fromByteArray, toByteArray } from 'react-native-quick-base64'

// 二维码载荷前缀，用于识别「这是我们导出的 WebDAV 配置」，避免误扫其它二维码
const PREFIX = 'LXWDCFG1:'

export interface WebDavQRConfig {
  url: string
  username: string
  password: string
  path: string
}

// 以下两个函数手动做 UTF-8 编解码，避免依赖全局 TextEncoder/btoa（Hermes 环境下不一定可用）
function utf8ToBytes(str: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i)
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const lo = str.charCodeAt(++i)
      code = 0x10000 + ((code & 0x3ff) << 10) + (lo & 0x3ff)
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    }
  }
  return new Uint8Array(bytes)
}

function bytesToUtf8(bytes: Uint8Array): string {
  let str = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i++]
    if (b < 0x80) {
      str += String.fromCharCode(b)
    } else if (b < 0xe0) {
      str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f))
    } else if (b < 0xf0) {
      str += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f))
    } else {
      let code = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
      code -= 0x10000
      str += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
    }
  }
  return str
}

/** 将 WebDAV 配置编码为可放进二维码的字符串（base64 + 前缀） */
export const encodeWebDavConfig = (cfg: WebDavQRConfig): string => {
  const json = JSON.stringify({
    v: 1,
    url: cfg.url,
    username: cfg.username,
    password: cfg.password,
    path: cfg.path,
  })
  return PREFIX + fromByteArray(utf8ToBytes(json))
}

/** 从二维码字符串解析 WebDAV 配置；不是本应用导出的配置则返回 null */
export const decodeWebDavConfig = (raw: string): WebDavQRConfig | null => {
  if (!raw || !raw.startsWith(PREFIX)) return null
  try {
    const json = bytesToUtf8(toByteArray(raw.slice(PREFIX.length)))
    const obj = JSON.parse(json) as Partial<WebDavQRConfig> & { v?: number }
    if (typeof obj !== 'object' || obj == null || typeof obj.url !== 'string') return null
    return {
      url: String(obj.url ?? ''),
      username: String(obj.username ?? ''),
      password: String(obj.password ?? ''),
      path: String(obj.path ?? ''),
    }
  } catch {
    return null
  }
}
