import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, TextInput, FlatList, TouchableOpacity, type ListRenderItem } from 'react-native'
import { useI18n } from '@/lang'
import { useTheme } from '@/store/theme/hook'
import { createStyle, toast, confirmDialog } from '@/utils/tools'
import { Icon } from '@/components/common/Icon'
import Text from '@/components/common/Text'
import StatusBar from '@/components/common/StatusBar'
import Loading from '@/components/common/Loading'
import CheckBoxItem from '../Setting/components/CheckBoxItem'
import { useSettingValue } from '@/store/setting/hook'
import { updateSetting } from '@/core/common'
import {
  getCacheList,
  getCacheStat,
  searchCache,
  removeCache,
  removeCaches,
  clearAllCache,
  type OfflineCacheItem,
} from '@/core/music/offlineCache'

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

export default () => {
  const t = useI18n()
  const theme = useTheme()
  const isEnableOfflineCache = useSettingValue('common.isEnableOfflineCache')
  const [list, setList] = useState<OfflineCacheItem[]>([])
  const [stat, setStat] = useState<{ count: number, size: number }>({ count: 0, size: 0 })
  const [keyword, setKeyword] = useState('')
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(() => {
    setRefreshing(true)
    void Promise.all([
      getCacheStat().then(setStat),
      (() => {
        const kw = keyword.trim()
        return kw ? searchCache(kw) : getCacheList()
      })().then(setList),
    ]).finally(() => {
      setRefreshing(false)
    })
  }, [keyword])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleSearch = (text: string) => {
    setKeyword(text)
    const kw = text.trim()
    void (kw ? searchCache(kw) : getCacheList()).then(setList)
  }

  const toggleSelect = (item: OfflineCacheItem) => {
    setSelected(prev => {
      const next = new Set(prev)
      const key = `${item.source}__${item.id}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleSingleDelete = async(item: OfflineCacheItem) => {
    await removeCache({ source: item.source, id: item.id })
    toast(t('offline_cache_deleted'))
    refresh()
  }

  const handleBatchDelete = async() => {
    const targets = list
      .filter(item => selected.has(`${item.source}__${item.id}`))
      .map(item => ({ source: item.source, id: item.id }))
    if (!targets.length) return
    const confirm = await confirmDialog({
      message: t('offline_cache_delete_confirm', { count: targets.length }),
      confirmButtonText: t('confirm'),
    })
    if (!confirm) return
    await removeCaches(targets)
    setSelected(new Set())
    setIsSelectMode(false)
    toast(t('offline_cache_deleted'))
    refresh()
  }

  const handleClearAll = async() => {
    const confirm = await confirmDialog({
      message: t('offline_cache_clear_confirm'),
      confirmButtonText: t('confirm'),
    })
    if (!confirm) return
    await clearAllCache()
    setSelected(new Set())
    setIsSelectMode(false)
    toast(t('offline_cache_cleared'))
    refresh()
  }

  const handleSelectAll = () => {
    if (selected.size === list.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(list.map(item => `${item.source}__${item.id}`)))
    }
  }

  const allSelected = list.length > 0 && selected.size === list.length

  const renderItem: ListRenderItem<OfflineCacheItem> = ({ item }) => {
    const key = `${item.source}__${item.id}`
    const isSelected = selected.has(key)
    return (
      <TouchableOpacity
        style={{ ...styles.row, borderBottomColor: theme['c-border-background'] }}
        onPress={() => {
          if (isSelectMode) toggleSelect(item)
        }}
      >
        { isSelectMode
          ? <Icon
              style={styles.rowCheck}
              name={isSelected ? 'checkbox-marked' : 'checkbox-blank-outline'}
              color={theme['c-primary-font-active']}
              size={20}
            />
          : null }
        <View style={styles.rowMain}>
          <Text style={styles.rowName} numberOfLines={1} color={theme['c-font']}>{item.name}</Text>
          <Text style={styles.rowSub} numberOfLines={1} color={theme['c-font-label']}>
            {item.singer} · {item.quality} · {item.source}
          </Text>
        </View>
        <Text style={styles.rowSize} color={theme['c-font-label']}>{formatSize(item.size)}</Text>
        { isSelectMode
          ? null
          : <TouchableOpacity
              style={styles.rowDelete}
              onPress={() => { void handleSingleDelete(item) }}
            >
              <Icon name="remove" color={theme['c-font-label']} size={20} />
            </TouchableOpacity> }
      </TouchableOpacity>
    )
  }

  const toolbar = isSelectMode
    ? <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolBtn} onPress={() => { setIsSelectMode(false); setSelected(new Set()) }}>
          <Icon name="close" color={theme['c-button-font']} size={20} />
          <Text style={styles.toolBtnText} color={theme['c-button-font']}>{t('offline_cache_cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={handleSelectAll}>
          <Icon name={allSelected ? 'checkbox-marked' : 'checkbox-blank-outline'} color={theme['c-button-font']} size={20} />
          <Text style={styles.toolBtnText} color={theme['c-button-font']}>{t('offline_cache_select_all')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={() => { void handleBatchDelete() }}>
          <Icon name="remove" color={theme['c-button-font']} size={20} />
          <Text style={styles.toolBtnText} color={theme['c-button-font']}>{t('offline_cache_batch_delete')}</Text>
        </TouchableOpacity>
      </View>
    : <View style={styles.toolbar}>
        <Text style={styles.statText} color={theme['c-font-label']}>
          {t('offline_cache_size', { count: stat.count, size: formatSize(stat.size) })}
        </Text>
        <View style={styles.toolBtnsRight}>
          <TouchableOpacity style={styles.toolBtn} onPress={() => { setIsSelectMode(true) }}>
            <Icon name="checkbox-blank-outline" color={theme['c-button-font']} size={20} />
            <Text style={styles.toolBtnText} color={theme['c-button-font']}>{t('offline_cache_batch_delete')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toolBtn} onPress={() => { void handleClearAll() }}>
            <Icon name="remove" color={theme['c-button-font']} size={20} />
            <Text style={styles.toolBtnText} color={theme['c-button-font']}>{t('offline_cache_clear_all')}</Text>
          </TouchableOpacity>
        </View>
      </View>

  const content = useMemo(() => (
    <FlatList
      data={list}
      keyExtractor={item => `${item.source}__${item.id}`}
      renderItem={renderItem}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText} color={theme['c-font-label']}>{t('offline_cache_empty')}</Text>
        </View>
      }
    />
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [list, isSelectMode, selected, theme, t])

  return (
    <View style={[styles.container, { backgroundColor: theme['c-content-background'] }]}>
      <StatusBar />
      <View style={{ ...styles.header, borderBottomColor: theme['c-border-background'] }}>
        <Text style={styles.title} color={theme['c-font']}>{t('offline_cache_title')}</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => { refresh() }} disabled={refreshing}>
          { refreshing
            ? <Loading color={theme['c-button-font']} style={styles.refreshLoading} />
            : <Icon name="available_updates" color={theme['c-button-font']} size={20} /> }
        </TouchableOpacity>
      </View>
      <View style={styles.enableRow}>
        <CheckBoxItem
          check={isEnableOfflineCache}
          onChange={(v) => { updateSetting({ 'common.isEnableOfflineCache': v }) }}
          label={t('offline_cache_enable')} />
      </View>
      { !isEnableOfflineCache
        ? <View style={styles.listWrap}>
            <View style={styles.empty}>
              <Text style={styles.emptyText} color={theme['c-font-label']}>{t('offline_cache_disabled_tip')}</Text>
            </View>
          </View>
        : <>
          <View style={styles.searchBar}>
            <Icon style={styles.searchIcon} name="search-2" color={theme['c-font-label']} size={16} />
            <TextInput
              style={{ ...styles.searchInput, color: theme['c-font'] }}
              placeholder={t('offline_cache_search_placeholder')}
              placeholderTextColor={theme['c-font-label']}
              value={keyword}
              onChangeText={handleSearch}
            />
          </View>
          {toolbar}
          <View style={styles.listWrap}>
            {content}
          </View>
        </> }
    </View>
  )
}

const styles = createStyle({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    paddingLeft: 15,
    paddingRight: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    flex: 1,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshLoading: {
    width: 20,
    height: 20,
  },
  enableRow: {
    paddingLeft: 15,
    paddingRight: 15,
    height: 44,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: 10,
    paddingLeft: 10,
    paddingRight: 10,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  searchIcon: {
    marginRight: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingLeft: 10,
    paddingRight: 10,
  },
  toolBtnsRight: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 10,
    paddingRight: 10,
    height: 44,
  },
  toolBtnText: {
    fontSize: 13,
    marginLeft: 4,
  },
  statText: {
    flex: 1,
    fontSize: 13,
  },
  listWrap: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 15,
    paddingRight: 10,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  rowCheck: {
    marginRight: 10,
  },
  rowMain: {
    flex: 1,
  },
  rowName: {
    fontSize: 15,
  },
  rowSub: {
    fontSize: 12,
    marginTop: 3,
  },
  rowSize: {
    fontSize: 12,
    marginLeft: 10,
  },
  rowDelete: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 14,
  },
})
