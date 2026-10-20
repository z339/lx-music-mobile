import { getData, saveData } from '@/plugins/storage'
import { stringMd5 } from 'react-native-quick-md5'
import { byteArrayFromBase64, utf8FromByteArray } from 'react-native-quick-base64'
import { inflate } from 'pako'

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

// 编码：移动端直接以纯 JSON 写入（避免 RN fetch 发送二进制 gzip 体的兼容性问题）。
export const encodeData = async (data: string): Promise<string> => data

// 解码 any-listen 桌面端写入的 `cg_`(gzip+base64) 数据；移动端自身只写纯 JSON，
// 故读取时兼容两种形式：以 `cg_` 开头则解压，否则原样返回。
const unGZipString = (data: string): string => {
  const bytes = byteArrayFromBase64(data)
  const out = inflate(bytes)
  return utf8FromByteArray(out)
}

export const decodeData = (data: string): string => {
  return data.startsWith('cg_') ? unGZipString(data.replace('cg_', '')) : data
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
