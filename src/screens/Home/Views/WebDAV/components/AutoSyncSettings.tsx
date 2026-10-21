import { memo, useCallback, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'

import CheckBoxItem from '../../Setting/components/CheckBoxItem'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import type { Message } from '@/lang'
import { updateSetting } from '@/core/common'
import { useSettingValue } from '@/store/setting/hook'
import { useTheme } from '@/store/theme/hook'
import { createStyle, confirmDialog } from '@/utils/tools'
import { SYNC_INTERVALS, type SyncInterval, refreshAutoSync } from '@/plugins/sync/webdav/autoSync'

const OPTIONS: Array<{ key: SyncInterval, labelKey: keyof Message }> = [
  { key: 'HOUR_1', labelKey: 'setting_sync_webdav_interval_1h' },
  { key: 'HOUR_6', labelKey: 'setting_sync_webdav_interval_6h' },
  { key: 'DAY_1', labelKey: 'setting_sync_webdav_interval_1d' },
  { key: 'WEEK_1', labelKey: 'setting_sync_webdav_interval_7d' },
]

const INTERVAL_KEYS = OPTIONS.map((o) => o.key)

// 把设置里的毫秒数反查为选项 key
const toOptionKey = (value: number): SyncInterval | null => {
  for (const key of INTERVAL_KEYS) {
    if (SYNC_INTERVALS[key] == value) return key
  }
  return null
}

const formatDateTime = (time: number): string => {
  const d = new Date(time)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const AutoSyncSettings = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const interval = useSettingValue('sync.webdav.interval')
  const lastSyncTime = useSettingValue('sync.webdav.lastSyncTime')
  const [pickerVisible, setPickerVisible] = useState(false)

  const enabled = interval > 0
  const currentKey = toOptionKey(interval)

  const handleToggle = useCallback((enable: boolean) => {
    // 开启时若无预设间隔，默认 1 天
    updateSetting({ 'sync.webdav.interval': enable ? SYNC_INTERVALS.DAY_1 : 0 })
    setPickerVisible(enable)
    refreshAutoSync()
  }, [])

  const handleSelect = useCallback((key: SyncInterval) => {
    updateSetting({ 'sync.webdav.interval': SYNC_INTERVALS[key] })
    setPickerVisible(false)
    refreshAutoSync()
  }, [])

  const handleDisable = useCallback(async () => {
    const confirmed = await confirmDialog({
      message: t('setting_sync_webdav_auto_sync_disable_confirm'),
      confirmButtonText: t('dialog_confirm'),
      cancelButtonText: t('dialog_cancel'),
    })
    if (!confirmed) return
    updateSetting({ 'sync.webdav.interval': 0 })
    setPickerVisible(false)
    refreshAutoSync()
  }, [t])

  const nextSyncText = (() => {
    if (!enabled) return ''
    if (!lastSyncTime) return t('setting_sync_webdav_auto_sync_next_run_now')
    const delay = Math.max(0, lastSyncTime + interval - Date.now())
    const next = new Date(Date.now() + delay)
    return t('setting_sync_webdav_auto_sync_next_run', { time: formatDateTime(next.getTime()) })
  })()

  return (
    <View style={styles.container}>
      <CheckBoxItem
        check={enabled}
        onChange={handleToggle}
        disabled={false}
        label={t('setting_sync_webdav_auto_sync')} />

      {enabled ? (
        <>
          <Text style={styles.label} size={13} color={theme['c-font-label']}>
            {t('setting_sync_webdav_interval')}
          </Text>
          <View style={styles.options}>
            {OPTIONS.map((o) => {
              const active = currentKey == o.key
              return (
                <TouchableOpacity
                  key={o.key}
                  style={[styles.option, { backgroundColor: active ? theme['c-primary-background'] : 'rgba(0,0,0,0.15)' }]}
                  activeOpacity={0.6}
                  onPress={() => { handleSelect(o.key) }}
                >
                  <Text size={13} color={active ? theme['c-primary'] : theme['c-font']}>{t(o.labelKey)}</Text>
                </TouchableOpacity>
              )
            })}
            <TouchableOpacity
              style={[styles.option, { backgroundColor: 'rgba(0,0,0,0.15)' }]}
              activeOpacity={0.6}
              onPress={() => { void handleDisable() }}
            >
              <Text size={13} color={theme['c-font-label']}>{t('setting_sync_webdav_interval_off')}</Text>
            </TouchableOpacity>
          </View>
          {nextSyncText ? (
            <Text style={styles.next} size={12} color={theme['c-font-label']}>{nextSyncText}</Text>
          ) : null}
        </>
      ) : null}
    </View>
  )
})

export default AutoSyncSettings


const styles = createStyle({
  container: {
    marginTop: 5,
  },
  label: {
    marginLeft: 25,
    marginTop: 8,
    marginBottom: 6,
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: 25,
  },
  option: {
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 4,
    marginRight: 10,
    marginBottom: 8,
  },
  next: {
    marginLeft: 25,
    marginBottom: 4,
  },
})