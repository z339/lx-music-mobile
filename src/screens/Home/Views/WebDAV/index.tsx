import { memo, useCallback } from 'react'
import { ScrollView } from 'react-native'

import Config from './components/Config'
import AutoSyncSettings from './components/AutoSyncSettings'
import DebugLogs from './components/DebugLogs'
import UserApiList from './components/UserApiList'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useBackHandler } from '@/utils/hooks/useBackHandler'
import { createStyle } from '@/utils/tools'
import commonState from '@/store/common/state'
import { setNavActiveId } from '@/core/common'

/**
 * WebDAV 独立页面
 *
 * 抽屉菜单「设置」下方的「WebDAV」入口进入本页。
 * 后续 WebDAV 相关功能均在本目录（Views/WebDAV）内迭代，
 * 不再改动设置页（Setting/settings/Sync）。
 */
export default () => {
  const t = useI18n()
  const debugEnable = useSettingValue('sync.webdav.debugEnable')

  // 返回键：回到上一个页面（与设置页行为一致）
  useBackHandler(useCallback(() => {
    if (Object.keys(commonState.componentIds).length == 1 && commonState.navActiveId == 'nav_webdav') {
      setNavActiveId(commonState.lastNavActiveId)
      return true
    }
    return false
  }, []))

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="always"
    >
      <Config />
      <UserApiList />
      {debugEnable ? <DebugLogs /> : null}
    </ScrollView>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  content: {
    paddingLeft: 15,
    paddingRight: 15,
    paddingTop: 15,
    paddingBottom: 30,
  },
})