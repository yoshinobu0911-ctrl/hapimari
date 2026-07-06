import { Alert, Platform } from 'react-native';

/**
 * 破壊的操作の確認ダイアログ（SPEC §2: すべての破壊的操作に確認ダイアログ）。
 * Alert.alert は react-native-web では動作しないため、Webは window.confirm で代替する。
 */
export function confirmDialog(title: string, message: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: 'はい', style: 'destructive', onPress: onConfirm },
  ]);
}

/** 情報ダイアログ（OKのみ） */
export function infoDialog(title: string, message: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message, [{ text: 'OK' }]);
}
