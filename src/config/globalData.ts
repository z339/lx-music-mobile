import { version } from '../../package.json'
import { createAppEventHub } from '@/event/appEvent'
import { createListEventHub } from '@/event/listEvent'
import { createDislikeEventHub } from '@/event/dislikeEvent'
import { createStateEventHub } from '@/event/stateEvent'
if (process.versions == null) {
  // @ts-expect-error
  process.versions = {
    app: version,
  }
} else process.versions.app = version

// global.i18n = null

// let screenW = Dimensions.get('window').width
// let screenH = Dimensions.get('window').height
// if (screenW > screenH) {
//   const temp = screenW
//   screenW = screenH
//   screenH = temp
// }


global.lx = {
  fontSize: 1,
  playerStatus: {
    isInitialized: false,
    isRegisteredService: false,
    isIniting: false,
  },

  restorePlayInfo: null,
  // allList: null,
  // globalObj: null,
  // listScrollPosition: {},
  // listSort: {},

  isScreenKeepAwake: false,

  // 是否播放完后退出应用
  isPlayedStop: false,

  // prevListPlayIndex: -1,

  // syncKeyInfo: {},

  isEnableSyncLog: false,
  isEnableUserApiLog: false,

  playerTrackId: '',

  gettingUrlId: '',

  qualityList: {},
  apis: {},
  apiInitPromise: [Promise.resolve(false), true, () => {}],

  jumpMyListPosition: false,

  settingActiveId: 'basic',

  homePagerIdle: true,

  // syncKeyInfo: initValue as LX.Sync.KeyInfo,

  // windowInfo: {
  //   screenW,
  //   screenH,
  //   fontScale: PixelRatio.getFontScale(),
  //   pixelRatio: PixelRatio.get(),
  //   screenPxW: PixelRatio.getPixelSizeForLayoutSize(screenW),
  //   screenPxH: PixelRatio.getPixelSizeForLayoutSize(screenH),
  // },
}

global.app_event = createAppEventHub()
global.list_event = createListEventHub()
global.dislike_event = createDislikeEventHub()
global.state_event = createStateEventHub()

// 诊断：给每个 JS 运行时打一个唯一标记。
// 播放服务通过 headless task 注册（Android 上可能跑在独立的 JS 运行时里），
// 若标记不同，说明 global.app_event 是两个不同对象，播放状态事件无法传到界面。
;(global as any).__lxRuntimeMarker = Math.random().toString(36).slice(2, 10)
console.log('[lx] runtime marker =', (global as any).__lxRuntimeMarker)
