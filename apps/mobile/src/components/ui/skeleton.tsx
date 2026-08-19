import { useEffect, useRef } from 'react';
import { Animated, type DimensionValue, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/constants/theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  /** 写真枠など角丸を変えたいとき */
  borderRadius?: number;
  style?: ViewStyle;
}

/**
 * 読み込み中のプレースホルダ。
 * 「過剰なアニメーション不可」（designer_brief §4-5）のため、
 * 流れるシマーではなく明滅のみ・1.6秒周期のゆっくりした変化に留めている。
 */
export function Skeleton({ width = '100%', height = 16, borderRadius = radius.sm, style }: Props) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.85, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius, backgroundColor: colors.surfaceSunken, opacity },
        style,
      ]}
    />
  );
}

/** さがす画面のグリッド1枚分の骨組み */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton height={180} borderRadius={0} />
      <View style={styles.cardBody}>
        <Skeleton width="70%" height={20} />
        <Skeleton width="45%" height={16} />
      </View>
    </View>
  );
}

/** メッセージ・いいね一覧の1行分の骨組み */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={56} height={56} borderRadius={28} />
      <View style={styles.rowBody}>
        <Skeleton width="50%" height={18} />
        <Skeleton width="80%" height={16} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    margin: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  cardBody: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowBody: {
    flex: 1,
    gap: spacing.sm,
  },
});
