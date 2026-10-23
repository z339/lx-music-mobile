import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'

import Dialog, { type DialogType } from '@/components/common/Dialog'
import { Camera, useCameraDevice, useCameraPermission, type CodeScanner } from 'react-native-vision-camera'
import Text from '@/components/common/Text'
import { useI18n } from '@/lang'
import { createStyle, toast } from '@/utils/tools'
import { useTheme } from '@/store/theme/hook'
import { decodeWebDavConfig, type WebDavQRConfig } from './qrConfig'

interface Props {
  visible: boolean
  onClose: () => void
  onImport: (cfg: WebDavQRConfig) => void
}

const QrScanModal = memo(({ visible, onClose, onImport }: Props) => {
  const t = useI18n()
  const theme = useTheme()
  const dialogRef = useRef<DialogType>(null)
  const device = useCameraDevice('back')
  const { hasPermission, requestPermission } = useCameraPermission()
  const scannedRef = useRef(false)

  useEffect(() => {
    dialogRef.current?.setVisible(visible)
  }, [visible])

  useEffect(() => {
    if (visible && !hasPermission) void requestPermission()
  }, [visible, hasPermission, requestPermission])

  useEffect(() => {
    if (!visible) scannedRef.current = false
  }, [visible])

  const handleScanned = useCallback((codes: Array<{ value?: string | null }>) => {
    if (scannedRef.current) return
    const value = codes[0]?.value
    if (!value) return
    const cfg = decodeWebDavConfig(value)
    if (!cfg) {
      toast(t('setting_sync_webdav_qr_import_invalid'))
      return
    }
    scannedRef.current = true
    onImport(cfg)
  }, [onImport, t])

  const codeScanner = useMemo<CodeScanner>(() => ({
    codeTypes: ['qr'],
    onCodeScanned: handleScanned,
  }), [handleScanned])

  const showCamera = visible && hasPermission && device != null

  // 摄像头不可用时的提示文案
  const placeholderTip = !hasPermission
    ? t('setting_sync_webdav_qr_permission_denied')
    : !device
        ? t('setting_sync_webdav_qr_no_camera')
        : ''

  return (
    <Dialog ref={dialogRef} title={t('setting_sync_webdav_qr_scan')} onHide={onClose} bgHide={false}>
      <View style={styles.wrap}>
        {showCamera
          ? <Camera style={styles.camera} device={device} isActive={visible} codeScanner={codeScanner} />
          : <View style={styles.placeholder}>
              <Text size={13} color={theme['c-font-label']} style={styles.placeholderText}>
                {placeholderTip}
              </Text>
            </View>}
        <Text style={styles.tip} size={12} color={theme['c-font-label']}>
          {t('setting_sync_webdav_qr_tip')}
        </Text>
      </View>
    </Dialog>
  )
})

const styles = createStyle({
  wrap: {
    padding: 16,
    alignItems: 'center',
  },
  camera: {
    width: '100%',
    height: 320,
    borderRadius: 8,
    overflow: 'hidden',
  },
  placeholder: {
    width: '100%',
    height: 320,
    borderRadius: 8,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  placeholderText: {
    textAlign: 'center',
  },
  tip: {
    marginTop: 12,
    textAlign: 'center',
  },
})

export default QrScanModal
