import { memo, useEffect, useRef } from 'react'
import { View } from 'react-native'

import Dialog, { type DialogType } from '@/components/common/Dialog'
import QRCode from 'react-native-qrcode-svg'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { createStyle } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { encodeWebDavConfig, type WebDavQRConfig } from './qrConfig'

interface Props {
  visible: boolean
  config: WebDavQRConfig
  onClose: () => void
}

const QrShareModal = memo(({ visible, config, onClose }: Props) => {
  const t = useI18n()
  const theme = useTheme()
  const dialogRef = useRef<DialogType>(null)

  useEffect(() => {
    dialogRef.current?.setVisible(visible)
  }, [visible])

  const payload = encodeWebDavConfig(config)

  return (
    <Dialog ref={dialogRef} title={t('setting_sync_webdav_qr_share')} onHide={onClose} bgHide>
      <View style={styles.wrap}>
        <View style={styles.qrBox}>
          <QRCode value={payload} size={220} backgroundColor="white" color="black" />
        </View>
        <Text style={styles.tip} size={12} color={theme['c-font-label']}>
          {t('setting_sync_webdav_qr_tip')}
        </Text>
      </View>
    </Dialog>
  )
})

const styles = createStyle({
  wrap: {
    padding: 20,
    alignItems: 'center',
  },
  qrBox: {
    padding: 12,
    backgroundColor: '#ffffff',
    borderRadius: 8,
  },
  tip: {
    marginTop: 14,
    textAlign: 'center',
  },
})

export default QrShareModal
