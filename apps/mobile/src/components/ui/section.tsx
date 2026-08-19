import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/constants/theme';

interface Props {
  title?: string;
  /** 見出しの下に添える説明 */
  description?: string;
  children: ReactNode;
  /** 上に区切り線と余白を入れる */
  divided?: boolean;
}

/**
 * セクション。見出し・説明・中身の間隔を1箇所で決める。
 * v1 は画面ごとに marginBottom を手書きしていて、余白のリズムが揃っていなかった。
 */
export function Section({ title, description, children, divided = false }: Props) {
  return (
    <View style={[styles.container, divided && styles.divided]}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xl,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.xl,
  },
  title: {
    ...typography.heading,
    marginBottom: spacing.xs,
  },
  description: {
    ...typography.caption,
    marginBottom: spacing.sm,
  },
  body: {
    marginTop: spacing.sm,
  },
});
