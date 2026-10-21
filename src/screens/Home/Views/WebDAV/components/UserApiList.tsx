import { memo, useCallback, useMemo } from 'react'
import { View, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import Button from '../../Setting/components/Button'
import { useI18n } from '@/lang'
import { useSettingValue } from '@/store/setting/hook'
import { useUserApiList } from '@/store/userApi'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast } from '@/utils/tools'
import { setApiSource } from '@/core/apiSource'
import apiSourceInfo from '@/utils/musicSdk/api-source-info'

/**
 * 同步得到的音源列表。
 *
 * 同步只是把音源数据写入本地（storage 的 `@user_api__` 与 `@user_api__{id}`），
 * 要真正生效还需把对应音源设为「自定义源」。这里直接列出已同步的音源供一键切换，
 * 免去再去「设置 → 基本 → 自定义源」逐个查找。
 */
const UserApiList = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const list = useUserApiList()
  const currentId = useSettingValue('common.apiSource')

  const handleSelect = useCallback((id: string) => {
    setApiSource(id)
    toast(t('setting_basic_source'))
  }, [t])

  const items = useMemo(() => list.filter((api) => !!api?.id), [list])

  return (
    <View style={styles.container}>
      <Text style={styles.title} size={14}>{t('setting_sync_webdav_manage_source')}</Text>

      {items.length ? (
        <>
          {items.map((api) => {
            const active = currentId == api.id
            return (
              <TouchableOpacity
                key={api.id}
                style={[styles.item, {
                  borderColor: active ? theme['c-primary'] : theme['c-border-background'],
                  backgroundColor: active ? theme['c-primary-background'] : 'rgba(0,0,0,0.04)',
                }]}
                activeOpacity={0.6}
                onPress={() => { handleSelect(api.id) }}
              >
                <View style={styles.info}>
                  <Text size={13} numberOfLines={1}>{api.name || api.id}</Text>
                  {api.version ? <Text size={11} color={theme['c-font-label']}>v{api.version}</Text> : null}
                </View>
                {active ? (
                  <Text size={12} color={theme['c-primary']}>{t('setting_basic_source_status_success')}</Text>
                ) : null}
              </TouchableOpacity>
            )
          })}
          <Text style={styles.tip} size={11} color={theme['c-font-label']}>
            {t('setting_sync_webdav_source_usage')}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.tip} size={12} color={theme['c-font-label']}>
            {t('setting_sync_webdav_source_empty')}
          </Text>
          <View style={styles.btn}>
            <Button onPress={() => { setApiSource(apiSourceInfo.find((s) => !s.disabled)?.id ?? '') }}>
              {t('setting_basic_source_title')}
            </Button>
          </View>
        </>
      )}
    </View>
  )
})

export default UserApiList


const styles = createStyle({
  container: {
    marginTop: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
  },
  title: {
    fontWeight: 'bold',
    marginBottom: 10,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 9,
    paddingBottom: 9,
    borderRadius: 4,
    borderWidth: 1,
    marginBottom: 8,
  },
  info: {
    flex: 1,
  },
  tip: {
    marginTop: 4,
    marginBottom: 6,
  },
  btn: {
    flexDirection: 'row',
  },
})