import { Image } from 'expo-image';
import type { ImageStyle, StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Text, View } from 'react-native';
import { usePhotoUrl } from '@/lib/photo-url';

interface Props {
  /** photo_urls の1要素（バケット内パス or 外部URL）。なければプレースホルダ表示 */
  path: string | null | undefined;
  style: StyleProp<ImageStyle>;
  placeholderStyle?: StyleProp<ViewStyle>;
  placeholderText?: string;
  placeholderTextStyle?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * プロフィール写真（M6.5: 非公開バケット + 署名付きURL表示）。
 * ループ内でも使えるように usePhotoUrl をコンポーネントに閉じ込めている。
 */
export function ProfilePhoto({
  path,
  style,
  placeholderStyle,
  placeholderText = '写真なし',
  placeholderTextStyle,
  testID,
}: Props) {
  const url = usePhotoUrl(path);
  if (!url) {
    return (
      <View style={[style as StyleProp<ViewStyle>, placeholderStyle]} testID={testID}>
        <Text style={placeholderTextStyle}>{placeholderText}</Text>
      </View>
    );
  }
  return <Image source={{ uri: url }} style={style} contentFit="cover" testID={testID} />;
}
