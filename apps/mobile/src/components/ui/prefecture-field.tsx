import { PREFECTURES, type Prefecture } from '@hapimari/shared';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontSize, sizes, spacing } from '@/constants/theme';

interface Props {
  label?: string;
  required?: boolean;
  value: Prefecture | null;
  onChange: (value: Prefecture) => void;
}

/** 都道府県の選択（大きな行のリストをモーダル表示） */
export function PrefectureField({
  label = 'お住まいの都道府県',
  required,
  value,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}>（必須）</Text> : null}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="prefecture-field"
        onPress={() => setOpen(true)}
        style={styles.field}
      >
        <Text style={[styles.fieldText, !value && { color: colors.textSub }]}>
          {value ?? '選択してください'}
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modal, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.modalTitle}>都道府県を選択</Text>
          <ScrollView style={styles.list}>
            {PREFECTURES.map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={item}
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                }}
                style={[styles.row, item === value && styles.rowSelected]}
              >
                <Text style={[styles.rowText, item === value && styles.rowTextSelected]}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.closeButton}
          >
            <Text style={styles.closeButtonText}>閉じる</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.label,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  required: {
    color: colors.primary,
    fontWeight: '400',
  },
  field: {
    minHeight: sizes.inputHeight,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: sizes.radius,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
  },
  fieldText: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  modal: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  modalTitle: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  list: {
    flex: 1,
  },
  row: {
    minHeight: sizes.tapArea + 8,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.sm,
  },
  rowSelected: {
    backgroundColor: colors.primarySoft,
  },
  rowText: {
    fontSize: fontSize.body,
    color: colors.text,
  },
  rowTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
  closeButton: {
    height: sizes.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
  },
  closeButtonText: {
    fontSize: fontSize.button,
    color: colors.primary,
    fontWeight: '600',
  },
});
