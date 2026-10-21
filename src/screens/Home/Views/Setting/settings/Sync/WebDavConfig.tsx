import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'

import InputItem from '../../components/InputItem'
import Button from '../../components/Button'
import CheckBoxItem from '../../components/CheckBoxItem'
import DebugLogs from './DebugLogs'
import AutoSyncSettings from './AutoSyncSettings'
import Text from '@/components/common/Text'
import Loading from '@/components/common/Loading'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle, toast, tipDialog } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { getWebDavConfig, testConnection, syncNow } from '@/plugins/sync/webdav'

const addressRxp = /^https?:\/\/\S+/i

type ActionType = 'test' | 'sync' | null

const WebDavConfig = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const url = useSettingValue('sync.webdav.url')
  const username = useSettingValue('sync.webdav.username')
  const password = useSettingValue('sync.webdav.password')
  const path = useSettingValue('sync.webdav.path')
  const syncList = useSettingValue('sync.webdav.syncList')
  const syncDislike = useSettingValue('sync.webdav.syncDislike')
  const lastSyncTime = useSettingValue('sync.webdav.lastSyncTime')
  const debugEnable = useSettingValue('sync.webdav.debugEnable')

  // 当前正在执行的动作（用于按钮 loading 与禁用）
  const [action, setAction] = useState<ActionType>(null)

  const handleUrlChange = useCallback((text: string, cb: (v: string) => void) => {
    const v = text.trim()
    if (v && !addressRxp.test(v)) {
      toast(t('setting_sync_host_value_error_tip'), 'long')
      cb(url)
      return
    }
    updateSetting({ 'sync.webdav.url': v })
    cb(v)
  }, [url, t])

  // 普通工厂函数（非 Hook），为文本类输入项生成 onChanged 回调
  const makeTextChange = (key: 'sync.webdav.username' | 'sync.webdav.password' | 'sync.webdav.path') =>
    (text: string, cb: (v: string) => void) => {
      const v = text.trim()
      updateSetting({ [key]: v } as Partial<LX.AppSetting>)
      cb(v)
    }

  const handleTest = useCallback(async () => {
    if (action) return
    const config = getWebDavConfig()
    if (!config.url) {
      await tipDialog({ title: t('setting_sync_webdav_test'), message: t('setting_sync_webdav_url_empty') })
      return
    }
    setAction('test')
    try {
      const err = await testConnection(config)
      if (err) {
        await tipDialog({
          title: t('setting_sync_webdav_test'),
          message: t('setting_sync_webdav_test_fail', { message: err.message }),
        })
      } else {
        toast(t('setting_sync_webdav_test_success'))
      }
    } catch (err) {
      await tipDialog({
        title: t('setting_sync_webdav_test'),
        message: t('setting_sync_webdav_test_fail', { message: (err as Error).message }),
      })
    } finally {
      setAction(null)
    }
  }, [action, t])

  const handleSync = useCallback(async () => {
    if (action) return
    if (!url) {
      await tipDialog({ title: t('setting_sync_webdav_sync_now'), message: t('setting_sync_webdav_url_empty') })
      return
    }
    if (!syncList && !syncDislike) {
      await tipDialog({ title: t('setting_sync_webdav_sync_now'), message: t('setting_sync_webdav_no_task') })
      return
    }
    setAction('sync')
    try {
      const result = await syncNow()
      if (result.success) {
        toast(t('setting_sync_webdav_sync_success'))
      } else {
        // 错误信息形如 "i18nKey|详细错误"，拆分后分别翻译
        const [key, detail] = (result.error ?? '').split('|')
        const message = detail
          ? `${t(key as Parameters<typeof t>[0])}\n${detail}`
          : t(key as Parameters<typeof t>[0])
        await tipDialog({ title: t('setting_sync_webdav_sync_now'), message })
      }
    } catch (err) {
      await tipDialog({
        title: t('setting_sync_webdav_sync_now'),
        message: t('setting_sync_webdav_sync_fail', { message: (err as Error).message }),
      })
    } finally {
      setAction(null)
    }
  }, [action, url, syncList, syncDislike, t])

  const lastSyncText = (() => {
    if (!lastSyncTime) return t('setting_sync_webdav_never_synced')
    try {
      const d = new Date(lastSyncTime)
      const pad = (n: number) => `${n}`.padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    } catch {
      return t('setting_sync_webdav_never_synced')
    }
  })()

  const busy = action != null

  return (
    <View>
      <InputItem
        value={url}
        label={t('setting_sync_webdav_url')}
        onChanged={handleUrlChange}
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('setting_sync_webdav_url_tip')} />
      <InputItem
        value={username}
        label={t('setting_sync_webdav_username')}
        onChanged={makeTextChange('sync.webdav.username')}
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('setting_sync_webdav_username_tip')} />
      <InputItem
        value={password}
        label={t('setting_sync_webdav_password')}
        onChanged={makeTextChange('sync.webdav.password')}
        secureTextEntry
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('setting_sync_webdav_password_tip')} />
      <InputItem
        value={path}
        label={t('setting_sync_webdav_path')}
        onChanged={makeTextChange('sync.webdav.path')}
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t('setting_sync_webdav_path_tip')} />

      <View style={styles.options}>
        <CheckBoxItem
          check={syncList}
          onChange={(v) => { updateSetting({ 'sync.webdav.syncList': v }) }}
          label={t('setting_sync_webdav_sync_list')} />
        <CheckBoxItem
          check={syncDislike}
          onChange={(v) => { updateSetting({ 'sync.webdav.syncDislike': v }) }}
          label={t('setting_sync_webdav_sync_dislike')} />
        <CheckBoxItem
          check={debugEnable}
          onChange={(v) => { updateSetting({ 'sync.webdav.debugEnable': v }) }}
          label={t('setting_sync_webdav_debug_enable')} />
      </View>

      <AutoSyncSettings />

      {debugEnable ? <DebugLogs /> : null}

      <Text style={styles.lastSync} size={13} color={theme['c-font-label']}>
        {t('setting_sync_webdav_last_sync_time', { time: lastSyncText })}
      </Text>

      <View style={styles.btns}>
        <Button disabled={busy} onPress={handleTest}>
          {action === 'test' ? t('setting_sync_webdav_testing') : t('setting_sync_webdav_test')}
        </Button>
        <Button disabled={busy || !url} onPress={handleSync}>
          {action === 'sync' ? t('setting_sync_webdav_syncing') : t('setting_sync_webdav_sync_now')}
        </Button>
        {busy ? <Loading size={14} style={styles.loading} /> : null}
      </View>
    </View>
  )
})

export default WebDavConfig


const styles = createStyle({
  options: {
    marginTop: 10,
    marginBottom: 5,
  },
  lastSync: {
    marginLeft: 25,
    marginTop: 2,
    marginBottom: 6,
  },
  btns: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 15,
  },
  loading: {
    marginLeft: 4,
  },
})
