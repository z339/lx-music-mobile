global.Buffer = require('buffer').Buffer

/**
 * Hermes（React Native 的 JS 引擎）不提供 TextEncoder / TextDecoder / btoa / atob
 * 这些 Web 标准全局对象。部分第三方库会直接 `new TextEncoder()`，在真机上会抛：
 *   property 'TextEncoder' doesn't exist
 *   TextEncoder is not defined
 * 典型例子：react-native-qrcode-svg 依赖的 qrcode（lib/core/byte-data.js）。
 *
 * 这里统一补齐全局 polyfill：
 *   1. 修复第三方库在 Hermes 下直接崩溃的问题；
 *   2. 后续新增功能可以直接使用这些标准 API，
 *      不必再各自手写 UTF-8 编解码（避免重复实现且行为不一致）。
 * 仅实现 UTF-8，覆盖二维码、WebDAV、脚本通信等场景的实际需求。
 */
const createUtf8Polyfill = () => {
  class Utf8TextEncoder {
    get encoding() { return 'utf-8' }
    encode(input = '') {
      const str = String(input)
      const bytes = []
      for (let i = 0; i < str.length; i++) {
        let code = str.charCodeAt(i)
        // 代理对：高位 + 低位合成一个码点
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff)
            i++
          } else code = 0xfffd // 落单的高位代理
        } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd // 落单的低位代理
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
      return new Uint8Array(bytes)
    }
  }

  class Utf8TextDecoder {
    get encoding() { return 'utf-8' }
    decode(input) {
      if (input == null) return ''
      const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
      let str = ''
      let i = 0
      while (i < bytes.length) {
        const b = bytes[i++]
        let code
        if (b < 0x80) {
          code = b
        } else if (b < 0xe0) {
          code = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f)
        } else if (b < 0xf0) {
          code = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
        } else {
          code = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f)
          code -= 0x10000
          str += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff))
          continue
        }
        str += String.fromCharCode(code)
      }
      return str
    }
  }

  return { Utf8TextEncoder, Utf8TextDecoder }
}

if (typeof global.TextEncoder == 'undefined' || typeof global.TextDecoder == 'undefined') {
  const { Utf8TextEncoder, Utf8TextDecoder } = createUtf8Polyfill()
  global.TextEncoder = Utf8TextEncoder
  global.TextDecoder = Utf8TextDecoder
}

if (typeof global.btoa == 'undefined') {
  global.btoa = (str) => Buffer.from(String(str), 'binary').toString('base64')
}
if (typeof global.atob == 'undefined') {
  global.atob = (str) => Buffer.from(String(str), 'base64').toString('binary')
}
