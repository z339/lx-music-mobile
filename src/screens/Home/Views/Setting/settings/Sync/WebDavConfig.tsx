import { memo, useCallback, useState } from 'react'
import { View } from 'react-native'

import InputItem from '../../components/InputItem'
import Button from '../../components/Button'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { useStatus } from '@/store/sync/hook'
import { createStyle, toast } from '@/utils/tools'
import { getWebDavConfig, testConnection, syncNow } from '@/plugins/sync/webdav'

const addressRxp = /^https?:\/\/\S+/i

const WebDavConfig = memo(() => {
  const t = useI18n()
  const syncStatus = useStatus()
  const url = useSettingValue('sync.webdav.url')
  const username = useSettingValue('sync.webdav.username')
  const password = useSettingValue('sync.webdav.password')
  const path = useSettingValue('sync.webdav.path')

  const [testing, setTesting] = useState(false)

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
    const config = getWebDavConfig()
    if (!config.url) {
      toast(t('setting_sync_webdav_url_empty'))
      return
    }
    setTesting(true)
    const err = await testConnection(config)
    setTesting(false)
    if (err) toast(t('setting_sync_webdav_test_fail', { message: err.message }), 'long')
    else toast(t('setting_sync_webdav_test_success'))
  }, [t])

  const handleSync = useCallback(() => {
    void syncNow()
  }, [])

  const statusText = (): string => {
    const msg = syncStatus.message
    if (!msg) return syncStatus.status ? t('setting_sync_status_enabled') : t('sync_status_disabled')
    // 内部状态以 i18n key（setting_sync 前缀）存储，错误则直接显示原始信息
    return msg.startsWith('setting_sync') ? t(msg as keyof Message) : msg
  }

  const isSyncing = syncStatus.status
  const canSync = !!url && !isSyncing && !testing

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

      <View style={styles.btns}>
        <Button disabled={testing} onPress={handleTest}>{t('setting_sync_webdav_test')}</Button>
        <Button disabled={!canSync} onPress={handleSync}>{t('setting_sync_webdav_sync_now')}</Button>
      </View>

      <Text style={styles.status} size={13}>{t('setting_sync_status', { status: statusText() })}</Text>
    </View>
  )
})

export default WebDavConfig


const styles = createStyle({
  btns: {
    flexDirection: 'row',
    marginTop: 8,
    marginLeft: 15,
  },
  status: {
    marginLeft: 25,
    marginTop: 10,
  },
})
