import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { View, ScrollView, TouchableOpacity } from 'react-native'

import Text from '@/components/common/Text'
import Button from '../../components/Button'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast, tipDialog, clipboardWriteText } from '@/utils/tools'
import { externalStorageDirectoryPath } from '@/utils/fs'
import { getLogs, clearLogs, formatLogs, exportLogs, subscribeLogs } from '@/plugins/sync/webdav/logger'

const formatTime = (time: number): string => {
  const d = new Date(time)
  const pad = (n: number) => `${n}`.padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${`${d.getMilliseconds()}`.padStart(3, '0')}`
}

const DebugLogs = memo(() => {
  const t = useI18n()
  const theme = useTheme()
  const scrollRef = useRef<ScrollView>(null)
  const [version, setVersion] = useState(0)
  const [expanded, setExpanded] = useState(true)

  // 订阅日志变化，实时刷新
  useEffect(() => {
    const unsubscribe = subscribeLogs(() => setVersion((v) => v + 1))
    return () => { unsubscribe() }
  }, [])

  const logs = getLogs()

  const handleClear = useCallback(async () => {
    clearLogs()
    setVersion((v) => v + 1)
    toast(t('setting_sync_webdav_debug_cleared'))
  }, [t])

  const handleCopy = useCallback(async () => {
    const content = formatLogs()
    if (!content) {
      await tipDialog({ title: t('setting_sync_webdav_debug'), message: t('setting_sync_webdav_debug_empty') })
      return
    }
    clipboardWriteText(content)
    toast(t('setting_sync_webdav_debug_copied'))
  }, [t])

  const handleExport = useCallback(async () => {
    const content = formatLogs()
    if (!content) {
      await tipDialog({ title: t('setting_sync_webdav_debug'), message: t('setting_sync_webdav_debug_empty') })
      return
    }
    try {
      const path = await exportLogs(externalStorageDirectoryPath)
      await tipDialog({ title: t('setting_sync_webdav_debug'), message: t('setting_sync_webdav_debug_exported', { path }) })
    } catch (err) {
      await tipDialog({
        title: t('setting_sync_webdav_debug'),
        message: t('setting_sync_webdav_debug_export_fail', { message: (err as Error).message }),
      })
    }
  }, [t])

  // 日志级别配色：error 用红、warn 用橙（固定色，不随主题变化，便于快速识别）
  const levelColor = (level: string) => {
    switch (level) {
      case 'error': return '#e53935'
      case 'warn': return '#fb8c00'
      default: return theme['c-font-label']
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        activeOpacity={0.6}
        onPress={() => setExpanded((v) => !v)}
      >
        <Text size={13} style={styles.headerText}>
          {t('setting_sync_webdav_debug')} ({logs.length})
        </Text>
        <Text size={13} color={theme['c-font-label']}>{expanded ? '▾' : '▸'}</Text>
      </TouchableOpacity>

      {expanded ? (
        <>
          <View style={styles.actions}>
            <Button disabled={!logs.length} onPress={handleClear}>{t('setting_sync_webdav_debug_clear')}</Button>
            <Button disabled={!logs.length} onPress={handleCopy}>{t('setting_sync_webdav_debug_copy')}</Button>
            <Button disabled={!logs.length} onPress={handleExport}>{t('setting_sync_webdav_debug_export')}</Button>
          </View>

          {logs.length ? (
            <ScrollView
              ref={scrollRef}
              style={styles.list}
              nestedScrollEnabled
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
            >
              {logs.map((l) => (
                <View key={l.id} style={styles.item}>
                  <Text size={11} color={theme['c-font-label']}>{formatTime(l.time)}</Text>
                  <Text size={11} color={levelColor(l.level)} style={styles.level}>{l.level.toUpperCase()}</Text>
                  <Text size={11} style={styles.message}>{l.message}</Text>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text size={12} color={theme['c-font-label']} style={styles.empty}>
              {t('setting_sync_webdav_debug_empty')}
            </Text>
          )}
        </>
      ) : null}
    </View>
  )
})

export default DebugLogs


const styles = createStyle({
  container: {
    marginTop: 10,
    marginLeft: 15,
    marginRight: 15,
    padding: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    fontWeight: 'bold',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 4,
  },
  list: {
    maxHeight: 260,
    marginTop: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  level: {
    marginLeft: 6,
    marginRight: 6,
    minWidth: 42,
  },
  message: {
    flex: 1,
  },
  empty: {
    paddingVertical: 10,
  },
})
