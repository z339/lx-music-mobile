import { importUserApi } from '@/core/userApi'
import { setApiSource, isApiSourceAvailable } from '@/core/apiSource'
import settingState from '@/store/setting/state'
import { readFile } from '@/utils/fs'
import { log } from '@/utils/log'
import { toast } from '@/utils/tools'


export const handleImportScript = async(script: string) => {
  await importUserApi(script).then((info) => {
    toast(global.i18n.t('user_api_import_success_tip'))
    // 导入后若当前没有可用音源（例如此前已删除全部音源），
    // 自动切换到刚导入的音源，否则播放会一直停在「歌曲链接获取中」。
    if (!isApiSourceAvailable(settingState.setting['common.apiSource'])) setApiSource(info.id)
  }).catch((error: any) => {
    log.error(error.stack)
    toast(global.i18n.t('user_api_import_failed_tip', { message: error.message }), 'long')
  })
}

export const handleImportLocalFile = (path: string) => {
  // toast(global.i18n.t('setting_backup_part_import_list_tip_unzip'))
  void readFile(path).then(async script => {
    if (script == null) throw new Error('Read file failed')
    void handleImportScript(script)
  }).catch((error: any) => {
    toast(global.i18n.t('user_api_import_failed_tip', { message: error.message }), 'long')
  })
}

