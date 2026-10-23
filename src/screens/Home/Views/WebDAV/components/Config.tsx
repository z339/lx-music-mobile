import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'

import InputItem from '../../Setting/components/InputItem'
import Button from '../../Setting/components/Button'
import CheckBoxItem from '../../Setting/components/CheckBoxItem'
import AutoSyncSettings from './AutoSyncSettings'
import Text from '@/components/common/Text'
import Loading from '@/components/common/Loading'
import { useI18n } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { createStyle, toast, tipDialog } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { getWebDavConfig, testConnection, syncNow } from '@/plugins/sync/webdav'
import QrShareModal from './QrShareModal'
import QrScanModal from './QrScanModal'
import type { WebDavQRConfig } from './qrConfig'

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
  const syncUserApi = useSettingValue('sync.webdav.syncUserApi')
  const debugEnable = useSettingValue('sync.webdav.debugEnable')
  const lastSyncTime = useSettingValue('sync.webdav.lastSyncTime')

  // 当前正在执行的动作（用于按钮 loading 与禁用）
  const [action, setAction] = useState<ActionType>(null)
  // 二维码分享 / 扫码导入弹窗
  const [shareVisible, setShareVisible] = useState(false)
  const [scanVisible, setScanVisible] = useState(false)

  // 扫码导入：将二维码中的配置回填到设置项
  const handleQrImport = useCallback((cfg: WebDavQRConfig) => {
    updateSetting({
      'sync.webdav.url': cfg.url,
      'sync.webdav.username': cfg.username,
      'sync.webdav.password': cfg.password,
      'sync.webdav.path': cfg.path,
    })
    setScanVisible(false)
    toast(t('setting_sync_webdav_qr_import_success'))
  }, [t])

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
      const setting: Partial<LX.AppSetting> = { [key]: v }
      updateSetting(setting)
      cb(v)
    }

  const handleTest = useCallback(async() => {
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

  const handleSync = useCallback(async() => {
    if (action) return
    if (!url) {
      await tipDialog({ title: t('setting_sync_webdav_sync_now'), message: t('setting_sync_webdav_url_empty') })
      return
    }
    if (!syncList && !syncDislike && !syncUserApi) {
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
  }, [action, url, syncList, syncDislike, syncUserApi, t])

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
          check={syncUserApi}
          onChange={(v) => { updateSetting({ 'sync.webdav.syncUserApi': v }) }}
          label={t('setting_sync_webdav_sync_user_api')} />
        <CheckBoxItem
          check={debugEnable}
          onChange={(v) => { updateSetting({ 'sync.webdav.debugEnable': v }) }}
          label={t('setting_sync_webdav_debug_enable')} />
      </View>

      <AutoSyncSettings />

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
        <Button disabled={!url} onPress={() => { setShareVisible(true) }}>
          {t('setting_sync_webdav_qr_share')}
        </Button>
        <Button disabled={busy} onPress={() => { setScanVisible(true) }}>
          {t('setting_sync_webdav_qr_scan')}
        </Button>
        {busy ? <Loading size={14} style={styles.loading} /> : null}
      </View>

      <QrShareModal
        visible={shareVisible}
        config={{ url, username, password, path }}
        onClose={() => { setShareVisible(false) }} />
      <QrScanModal
        visible={scanVisible}
        onClose={() => { setScanVisible(false) }}
        onImport={handleQrImport} />
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
    flexWrap: 'wrap',
    rowGap: 8,
    alignItems: 'center',
    marginTop: 8,
    marginLeft: 15,
  },
  loading: {
    marginLeft: 4,
  },
})
