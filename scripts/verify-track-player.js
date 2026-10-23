/**
 * 验证 react-native-track-player 的产物是否可用：
 * 修复前（--esModuleInterop）：`import * as resolveAssetSource` 被编译成
 *   __importStar(require(...)) → 拿到对象 → resolveAssetSource(path) 抛
 *   "TypeError: Object is not a function" → TrackPlayer.add() 必然失败 → 一首歌都播不出来。
 * 修复后：直接 require，得到函数 → add() 正常。
 *
 * 用法：node scripts/verify-track-player.js
 */
const Module = require('node:module')
const path = require('node:path')

const pkgDir = path.join(__dirname, '..', 'node_modules', 'react-native-track-player')

// ---- mock react-native 与原生模块 ----
const calls = []
const nativeModule = {
  STATE_NONE: 0, STATE_READY: 1, STATE_PLAYING: 2, STATE_PAUSED: 3,
  STATE_STOPPED: 4, STATE_BUFFERING: 5, STATE_CONNECTING: 6,
  PITCH_ALGORITHM_LINEAR: 0, PITCH_ALGORITHM_MUSIC: 1, PITCH_ALGORITHM_VOICE: 2,
  setupPlayer: async (o) => { calls.push(['setupPlayer', o]) },
  add: async (tracks, before) => { calls.push(['add', tracks, before]) },
  remove: async (ids) => { calls.push(['remove', ids]) },
  skip: async (i) => { calls.push(['skip', i]) },
  play: async () => { calls.push(['play']) },
  pause: async () => { calls.push(['pause']) },
  stop: async () => { calls.push(['stop']) },
  seekTo: async (t) => { calls.push(['seekTo', t]) },
  getQueue: async () => [],
  getCurrentTrack: async () => 0,
  getTrack: async () => null,
  getDuration: async () => 0,
  getPosition: async () => 0,
  getState: async () => 0,
  getVolume: async () => 0,
  getRate: async () => 1,
  getRepeatMode: async () => 0,
  getBufferedPosition: async () => 0,
  isCached: async () => false,
  getCacheSize: async () => 0,
  clearCache: async () => {},
  updateOptions: async () => {},
  updateMetadataForTrack: async () => {},
  updateNowPlayingMetadata: async () => {},
  updateNowPlayingTitles: async () => {},
  clearNowPlayingMetadata: async () => {},
  removeUpcomingTracks: async () => {},
  reset: async () => {},
  setVolume: async () => {},
  setRate: async () => {},
  setRepeatMode: async () => {},
}
const reactNativeMock = {
  NativeModules: { TrackPlayerModule: nativeModule },
  Platform: { OS: 'android' },
  AppRegistry: { registerHeadlessTask: () => {} },
  DeviceEventEmitter: { addListener: () => ({ remove: () => {} }) },
  NativeEventEmitter: class { addListener() { return { remove: () => {} } } },
}
const originalLoad = Module._load
Module._load = function(request, parent, isMain) {
  if (request === 'react-native') return reactNativeMock
  if (request === 'react-native/Libraries/Image/resolveAssetSource') {
    // RN 内部该模块是 CommonJS: module.exports = fn
    return function resolveAssetSource(source) {
      if (typeof source === 'number') return { uri: 'asset://' + source }
      return null
    }
  }
  return originalLoad.apply(this, arguments)
}

const TrackPlayer = require(path.join(pkgDir, 'lib', 'trackPlayer.js')).default

const run = async() => {
  console.log('=== 1) setupPlayer ===')
  await TrackPlayer.setupPlayer({ maxCacheSize: 1024 })
  console.log('   ok')

  const mk = (url) => ({
    id: 'test__//1__//' + url,
    url,
    title: 'test',
    artist: 'test',
    userAgent: 'UA',
  })

  for (const [name, url] of [
    ['http 链接', 'https://raw.githubusercontent.com/mdn/webaudio-examples/main/audio-basics/outfoxing.mp3'],
    ['file 链接(离线缓存)', 'file:///data/user/0/cn.toside.music.mobile/files/OfflineCache/kw_kw_231846166_128k.mp3'],
  ]) {
    console.log(`=== 2) add(${name}) ===`)
    try {
      await TrackPlayer.add([mk(url)])
      const added = calls.find(c => c[0] === 'add')
      console.log('   ok, 原生收到 url =', added && added[1][0].url)
    } catch (err) {
      console.log('   ❌ 失败:', err && err.message)
      process.exitCode = 1
    }
  }

  console.log('=== 3) 播放控制链路 ===')
  try {
    await TrackPlayer.skip(0)
    await TrackPlayer.play()
    await TrackPlayer.pause()
    await TrackPlayer.seekTo(1000)
    console.log('   ok, 调用序列 =', calls.map(c => c[0]).join(' -> '))
  } catch (err) {
    console.log('   ❌ 失败:', err && err.message)
    process.exitCode = 1
  }

  if (!process.exitCode) console.log('\n✅ 全部通过：TrackPlayer 可正常添加曲目并控制播放')
}
run()
