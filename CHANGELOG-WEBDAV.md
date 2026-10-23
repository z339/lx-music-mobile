# WebDAV 分支功能变更记录（CHANGELOG-WEBDAV）

> 本文件**独立于上游 `CHANGELOG.md`**，仅记录 `webdav` 分支在 lx-music-mobile `v1.9.1` 基础上**新增/修改**的功能，便于版本追踪与发布说明。
> 上游原始变更仍见仓库根目录 `CHANGELOG.md`。

---

## v1.0.0（第一个版本，基于 lx-music-mobile v1.9.1）

发布日期：2026-10-23
对应代码提交：`3d30d3a`
生产 APK：`lx-music-mobile-v1.9.1-release-{arm64-v8a,armeabi-v7a,x86,x86_64,universal}.apk`

### 一、新增功能

#### 1. WebDAV 同步（核心新功能）
完整的 WebDAV 双向同步引擎与配置界面，可将本地设置、用户音源等数据备份到自建/第三方 WebDAV 并在多端恢复。

- **同步引擎**（`src/plugins/sync/webdav/`）
  - `webdav.ts` / `client.ts`：WebDAV 连接与 HTTP 封装（PROPFIND/GET/PUT/DELETE）。
  - `modules.ts`：同步任务编排（上传/下载/对比/调度）。
  - `merge.ts`：冲突合并策略（本地优先 / 远程优先 / 按时间戳）。
  - `autoSync.ts`：自动同步（定时与网络恢复后触发）。
  - `userApi.ts`：用户音源配置的同步与恢复。
  - `snapshotDataManage.ts`：快照数据管理。
  - `logger.ts`：同步调试日志。
  - `shared.ts` / `types.ts` / `pako.d.ts`：共享工具、类型定义、gzip 依赖类型。
- **同步设置页**（`src/screens/Home/Views/WebDAV/`）
  - `index.tsx`：WebDAV 入口与总览。
  - `Config.tsx`：服务器地址、用户名、密码、远端路径配置。
  - `AutoSyncSettings.tsx`：自动同步开关与策略。
  - `UserApiList.tsx`：可同步的音源列表管理。
  - `DebugLogs.tsx`：同步日志查看。
  - `QrShareModal.tsx` / `QrScanModal.tsx` / `qrConfig.ts`：配置二维码分享与扫码导入（见第 3 点）。
- **注册与初始化**
  - `src/plugins/sync/index.ts`：注册 WebDAV 同步插件。
  - `src/core/init/sync.ts`：启动时初始化同步模块。
  - `src/screens/Home/Views/Setting/settings/Sync/index.tsx`：设置内的「同步」页面。

#### 2. 离线缓存
新增本地音乐离线缓存能力，可在无网络时播放已缓存的歌曲。

- `src/core/music/offlineCache.ts`：离线缓存核心（下载、读取、统计、清理）。
- `src/utils/offlineCacheAction.ts`：缓存操作封装（单首 / 整列表）。
- `src/screens/Home/Views/OfflineCache/index.tsx`：**离线缓存页面**，标题栏带「刷新」按钮，用于确认新增缓存是否成功落盘。
- **整列表缓存入口**
  - 歌单页（`ActiveList.tsx`）「缓存整个列表」按钮：修复此前点击一直弹「暂无离线缓存」的问题（改用 `getListMusics()` 取真实整列）。
  - 「我的列表」长按歌单菜单（`MyList/ListMenu.tsx` + `MyList/index.tsx`）新增「缓存整个列表」选项（仅离线缓存开启时显示）。

#### 3. WebDAV 配置二维码分享 / 扫码导入
便于在多端快速迁移 WebDAV 连接配置。

- `src/screens/Home/Views/WebDAV/components/QrShareModal.tsx`：生成配置二维码分享。
- `src/screens/Home/Views/WebDAV/components/QrScanModal.tsx`：扫码导入配置。
- `src/screens/Home/Views/WebDAV/components/qrConfig.ts`：二维码编解码与加密。
- 依赖新增：`react-native-qrcode-svg`、`react-native-svg`、`react-native-vision-camera`，并对应调整 Android 构建配置（svg 锁 14.x）。

#### 4. 两个新功能开关（可与原始播放隔离）
- **同步音源开关** `sync.webdav.syncUserApi`：关闭时不参与 WebDAV 音源同步；同步后若当前无已选音源会自动激活一个已同步音源。
- **离线缓存开关** `common.isEnableOfflineCache`：关闭时强制纯在线播放，跳过一切缓存读取与写入。相关默认项见 `src/config/defaultSetting.ts`、`src/types/app_setting.d.ts`、`src/config/globalData.ts`、`src/core/apiSource.ts`。

### 二、修复

#### 1. 修复无法播放（核心 bug）
- `scripts/fix-git-deps-build.js`：去掉 `--esModuleInterop` / `--allowSyntheticDefaultImports`；新增 `fixWildcardRequire`（将 `react-native/Libraries/Image/resolveAssetSource` 的通配符导入还原为 `require()`），新增 `patchNativeStateMapping`（原生 `ExoPlayback.getState()` 改用 `getPlayWhenReady()` 代替不可靠的 `isPlaying()`）。
- 解决 `TrackPlayer.add()` 必抛 `Object is not a function` 导致全曲无法播放、UI 卡在「音乐加载中」的问题。
- `src/plugins/player/{hook,playList,service}.ts`、`src/core/player/player.ts`：取链标记 `gettingUrlId` 按值清理、`getCurrentTrackId` 改用 `TrackPlayer.getTrack`、播放串联加 `.catch()`、`useProgress` 在 app 下发播放时轮询进度。

#### 2. 修复 TextEncoder 崩溃（Hermes 兼容）
- `shim.js`：自实现 `TextEncoder` / `TextDecoder` / `btoa` / `atob`（UTF-8 字节级与标准一致），`index.js` 首行已 `import './shim'`，修复分享二维码时 `TextEncoder doesn't exist` 崩溃。后续新增功能统一复用，无需再手写 UTF-8 编解码。

### 三、其他支持改动
- 三语 i18n（`zh-cn` / `zh-tw` / `en-us`）新增离线缓存、二维码、同步相关 key。
- 联动更新：`OnlineList`、`SonglistDetail/ActionBar`、`UserApiEditModal`、`data.ts`、`core/init`、`Vertical/Main`、`Horizontal/Main` 等。
- `src/config/constant.ts`、`src/core/common.ts`、`src/core/userApi.ts`、`src/core/music/index.ts` 等适配新功能。

### 四、风险隔离说明（两个新功能不影响原始播放）
- 离线缓存关闭时，缓存链路（`getCacheFilePath` / `autoCollectOnPlay`）直接跳过，强制纯在线。
- 音源同步开关关闭时，WebDAV 同步任务门控跳过。
- 已通过三态真机验证（两功能全开 / 仅离线缓存关 / 两功能全关）均正常播放，30 项风险清单全部通过（见 `outputs/新功能风险清单与验证结果.md`）。

### 五、生产 APK 说明
- 构建命令：`cd android && ./gradlew assembleRelease`（JDK 21 + Android SDK）。
- 提供 5 个 ABI 变体（arm64-v8a / armeabi-v7a / x86 / x86_64 / universal），真机优先安装 `arm64-v8a`。
- 本版本 APK 命名：`lx-music-mobile-v1.9.1-release-{abi}.apk`，已上传至仓库 Releases（tag `webdav-v1.0.0`）。
