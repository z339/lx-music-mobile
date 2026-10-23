// import { setUserApi as setUserApiAction } from '@renderer/utils/ipc'
import musicSdk from '@/utils/musicSdk'
// import apiSourceInfo from '@renderer/utils/musicSdk/api-source-info'
import { updateSetting } from './common'
import settingState from '@/store/setting/state'
import { destroyUserApi, setUserApi } from './userApi'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'
import { state as userApiState } from '@/store/userApi'
import BackgroundTimer from 'react-native-background-timer'

const USER_API_PREFIX = 'user_api_'
// 脚本 init 超时（毫秒）：超过此时间仍未收到脚本的 init 事件，
// 直接判定为初始化失败，避免播放永远卡在「歌曲链接获取中」。
const API_INIT_TIMEOUT = 30_000

/** 自定义源 id 统一带 user_api_ 前缀 */
const normalizeUserApiId = (id: string) => `${USER_API_PREFIX}${id.replace(/^user_api_/, '')}`

/**
 * 在已安装的自定义源列表中查找与 apiId 对应的源，返回带前缀的规范 id；找不到返回 null。
 * 兼容三种情况：规范 id（user_api_xxx）、裸 id（xxx）、前缀重复（user_api_user_api_xxx）。
 */
export const matchUserApiId = (apiId: string): string | null => {
  if (!apiId) return null
  const match = userApiState.list.find(
    (i) => i.id === apiId || i.id === `${USER_API_PREFIX}${apiId}` || `${USER_API_PREFIX}${i.id}` === apiId,
  )
  return match ? normalizeUserApiId(match.id) : null
}

/**
 * 当前选中的音源是否仍然可用（已安装的自定义源，或仍存在的内置源）。
 * 本项目已移除全部内置音源（api-source-info 为空），
 * 因此只有选中一个已安装的自定义源才能播放歌曲。
 */
export const isApiSourceAvailable = (apiId: string): boolean => {
  if (!apiId) return false
  if (apiSourceInfo.some(api => api.id === apiId)) return true
  return matchUserApiId(apiId) != null
}

/**
 * 取得一个可用的自定义源 id：
 *   1. 当前选中的自定义源（若未被排除）；
 *   2. 否则取已安装列表中的第一个自定义源。
 * @param excludeId 需要排除的源 id（例如初始化失败的源）
 */
export const getAvailableUserApiId = (excludeId?: string): string | null => {
  const current = settingState.setting['common.apiSource']
  if (current && current !== excludeId) {
    const matched = matchUserApiId(current)
    if (matched) return matched
  }
  const target = userApiState.list.find(i => normalizeUserApiId(i.id) !== excludeId)
  return target ? normalizeUserApiId(target.id) : null
}

/**
 * 启动时决定使用哪个音源：当前设置仍有效则沿用，
 * 否则（为空 / 已被删除 / 未安装）自动选择一个已安装的自定义源。
 * 没有可用自定义源时保持原值，播放时会给出「未选择音源」的明确提示。
 */
export const getStartupApiSourceId = (currentId: string): string => {
  if (currentId) {
    if (apiSourceInfo.some(api => api.id === currentId)) return currentId
    const matched = matchUserApiId(currentId)
    if (matched) return matched
  }
  return getAvailableUserApiId() ?? currentId
}

export const setApiSource = (apiId: string) => {
  // 规范化：自定义源 id 必须带 user_api_ 前缀，否则 setUserApi 不会加载脚本、
  // 且 apis(source) 会回退到空的内置 API 列表，导致「歌曲链接获取中 / 尝试切换其他来源」。
  // 旧版本 WebDAV 同步或手动编辑可能写下缺前缀的裸 id（如「野花v1」），
  // 这里统一补全前缀，强制走 user_api 分支。
  if (!apiId.startsWith(USER_API_PREFIX) && !apiSourceInfo.some(api => api.id == apiId)) {
    const matched = matchUserApiId(apiId)
    if (matched) apiId = matched
  }

  // 重置 init promise 并加上超时保护：若脚本在 API_INIT_TIMEOUT 内未发送 init，
  // 直接 resolve(false)，让播放链路抛出「source init failed」而不是无限转圈。
  if (global.lx.apiInitPromise[1]) {
    global.lx.apiInitPromise[0] = new Promise(resolve => {
      global.lx.apiInitPromise[1] = false
      let timer: number | null = BackgroundTimer.setTimeout(() => {
        timer = null
        global.lx.apiInitPromise[2](false)
      }, API_INIT_TIMEOUT)
      global.lx.apiInitPromise[2] = (result: boolean) => {
        if (timer != null) {
          BackgroundTimer.clearTimeout(timer)
          timer = null
        }
        global.lx.apiInitPromise[1] = true
        resolve(result)
      }
    })
  }

  if (apiId.startsWith(USER_API_PREFIX)) {
    setUserApi(apiId).catch(err => {
      if (!global.lx.apiInitPromise[1]) global.lx.apiInitPromise[2](false)
      console.log(err)
      // 回退到内置音源（若存在）
      const api = apiSourceInfo.find(api => !api.disabled)
      if (api) {
        if (api.id != settingState.setting['common.apiSource']) setApiSource(api.id)
        return
      }
      // 本项目内置音源列表为空，回退到其它已安装的自定义源，
      // 否则当前音源失效后会一直「无法播放」而没有任何可用来源。
      const fallback = getAvailableUserApiId(apiId)
      if (fallback && fallback != settingState.setting['common.apiSource']) setApiSource(fallback)
    })
  } else {
    // @ts-expect-error
    global.lx.qualityList = musicSdk.supportQuality[apiId] ?? {}
    destroyUserApi()
    if (!global.lx.apiInitPromise[1]) global.lx.apiInitPromise[2](true)
    // apiSource.value = apiId
    // void setUserApiAction(apiId)
  }

  if (apiId != settingState.setting['common.apiSource']) {
    updateSetting({ 'common.apiSource': apiId })
    requestAnimationFrame(() => {
      global.state_event.apiSourceUpdated(apiId)
    })
  }
}
