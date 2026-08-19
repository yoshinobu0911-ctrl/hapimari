import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import type { ColorValue } from 'react-native';
import { colors, sizes } from '@/constants/theme';
import { useAuthStore } from '@/stores/auth';

/**
 * v1 はタブアイコンが絵文字（🔍💌💬👤）の仮実装で、
 * OSごとに色もサイズも揃わず品位を欠いていた（designer_brief §2.3-2）。
 * 選択中は塗り、非選択は線画にして、色に頼らず状態が分かるようにしている。
 */
function tabIcon(outline: keyof typeof Ionicons.glyphMap, filled: keyof typeof Ionicons.glyphMap) {
  return ({ focused, color }: { focused: boolean; color: ColorValue }) => (
    <Ionicons name={focused ? filled : outline} size={sizes.icon} color={color} />
  );
}

/** タブは最大4つ（SPEC §2: さがす / お相手から / メッセージ / マイページ） */
export default function TabsLayout() {
  const { session, initialized } = useAuthStore();
  if (initialized && !session) return <Redirect href="/(auth)/welcome" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSub,
        tabBarStyle: {
          height: sizes.tabBarHeight,
          paddingBottom: 8,
          paddingTop: 8,
          backgroundColor: colors.background,
          borderTopColor: colors.borderSubtle,
        },
        tabBarLabelStyle: {
          // ラベル4つを横に並べる制約上、本文16ptは入らない。
          // 常時見える固定ラベルであり、直上のアイコンと二重表示のため14ptとした。
          fontSize: 14,
          fontWeight: '600',
        },
      }}
    >
      <Tabs.Screen
        name="discover"
        options={{
          title: 'さがす',
          tabBarIcon: tabIcon('search-outline', 'search'),
        }}
      />
      <Tabs.Screen
        name="likes"
        options={{
          title: 'お相手から',
          tabBarIcon: tabIcon('heart-outline', 'heart'),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'メッセージ',
          tabBarIcon: tabIcon('chatbubble-outline', 'chatbubble'),
        }}
      />
      <Tabs.Screen
        name="mypage"
        options={{
          title: 'マイページ',
          tabBarIcon: tabIcon('person-outline', 'person'),
        }}
      />
    </Tabs>
  );
}
