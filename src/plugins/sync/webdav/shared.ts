import { getData, saveData } from '@/plugins/storage'
import { stringMd5 } from 'react-native-quick-md5'
import { toByteArray, fromByteArray } from 'react-native-quick-base64'
import { gzip, ungzip } from 'pako'

export const CANCELED_ERROR_MSG = 'Canceled'

// 远端目录/文件名常量（与 any-listen 完全一致，保证两端识别同一份数据）
export const CONSTANTS = {
  listDirectoryName: 'list',
  dislikeDirectoryName: 'dislike',
  snapshotDirectoryName: 'snapshots',
  snapshotListFileName: 'snapshot-list',
  snapshotInfoFileName: 'snapshot-info',
  lockFilePrefix: 'lock-',
} as const

// 与 any-listen 一致：小于该阈值的内容不压缩，直接以明文 JSON 存储
const COMPRESS_THRESHOLD = 1024

/**
 * 编码：与 any-listen 桌面端保持一致。
 * 超过 COMPRESS_THRESHOLD 时用 gzip 压缩并以 `cg_` 前缀 + base64 存储，
 * 否则原样返回明文 JSON。这样两端写出的文件能被对方正确解析。
 */
export const encodeData = (data: string): string => {
  if (data.length <= COMPRESS_THRESHOLD) return data
  const compressed = gzip(data)
  if (compressed.length >= data.length) return data
  return `cg_${fromByteArray(compressed)}`
}

/**
 * 解码：兼容 any-listen 桌面端写入的 `cg_`(gzip+base64) 数据与明文 JSON 两种形式。
 * 桌面端使用 zlib.gzip，故这里必须用 ungzip（gzip 容器），而非 inflate（裸 deflate）。
 * pako 的 `to: 'string'` 会按 UTF-8 解码，与桌面端 buf.toString() 行为一致。
 */
export const decodeData = (data: string): string => {
  if (!data.startsWith('cg_')) return data
  const bytes = toByteArray(data.slice(3))
  return ungzip(bytes, { to: 'string' })
}

export const generateId = (): string => stringMd5(`${Date.now()}_${Math.random()}`).slice(0, 16)

// 设备 ID：用于多设备快照协调（clients 映射）。同步开始前需调用 initDeviceId 载入持久化值。
const DEVICE_ID_KEY = 'webdav_device_id'
let deviceIdCache: string | null = null

export const getDeviceId = (): string => {
  if (deviceIdCache) return deviceIdCache
  deviceIdCache = generateId()
  return deviceIdCache
}

export const initDeviceId = async (): Promise<void> => {
  const saved = await getData<string>(DEVICE_ID_KEY)
  if (saved) deviceIdCache = saved
  else if (deviceIdCache) await saveData(DEVICE_ID_KEY, deviceIdCache)
}
