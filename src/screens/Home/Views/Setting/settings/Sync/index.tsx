import { memo, useState } from 'react'
import { View, TouchableOpacity } from 'react-native'

import Section from '../../components/Section'
import IsEnable from './IsEnable'
import History from './History'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting, setNavActiveId } from '@/core/common'
import { createStyle } from '@/utils/tools'
import Text from '@/components/common/Text'
import { useTheme } from '@/store/theme/hook'

type SyncType = 'server' | 'webdav'

const SyncTypeButton = memo(({ active, label, onPress }: {
  active: boolean
  label: string
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <TouchableOpacity
      style={[styles.typeBtn, active && { backgroundColor: theme['c-primary-background'] }]}
      activeOpacity={0.6}
      onPress={onPress}
    >
      <Text style={[styles.typeBtnText, active && { color: theme['c-primary'] }]} size={13}>{label}</Text>
    </TouchableOpacity>
  )
})

export default memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const syncType = useSettingValue('sync.type')
  const [host, setHost] = useState('')

  const handleTypeChange = (type: SyncType) => {
    // WebDAV 已有独立的抽屉入口，这里直接跳转过去，避免功能分散两处
    if (type == 'webdav') {
      updateSetting({ 'sync.type': 'webdav', 'sync.enable': false })
      setNavActiveId('nav_webdav')
      return
    }
    if (type == syncType) return
    updateSetting({ 'sync.type': type })
  }

  return (
    <Section title={t('setting_sync')}>
      <View style={styles.typeSelector}>
        <Text style={styles.typeLabel} size={14}>{t('setting_sync_mode')}</Text>
        <View style={styles.typeBtns}>
          <SyncTypeButton active={syncType == 'server'} label={t('setting_sync_mode_server')} onPress={() => { handleTypeChange('server') }} />
          <SyncTypeButton active={syncType == 'webdav'} label={t('setting_sync_mode_webdav')} onPress={() => { handleTypeChange('webdav') }} />
        </View>
      </View>

      {syncType == 'server' && (
        <>
          <IsEnable host={host} setHost={setHost} />
          <History setHost={setHost} />
        </>
      )}
      {syncType == 'webdav' && (
        <TouchableOpacity
          style={styles.gotoWebDav}
          activeOpacity={0.6}
          onPress={() => { setNavActiveId('nav_webdav') }}
        >
          <Text size={13} color={theme['c-font-label']}>{t('setting_sync_webdav_goto')}</Text>
        </TouchableOpacity>
      )}
    </Section>
  )
})


const styles = createStyle({
  typeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 25,
    marginBottom: 10,
  },
  typeLabel: {
    marginRight: 12,
  },
  typeBtns: {
    flexDirection: 'row',
  },
  typeBtn: {
    paddingLeft: 14,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 6,
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  typeBtnText: {
    opacity: 0.8,
  },
  typeBtnTextActive: {
    fontWeight: 'bold',
  },
  gotoWebDav: {
    marginLeft: 25,
    marginTop: 12,
  },
})
