import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';

export interface ScreenHeaderAction {
  icon: IconName;
  label: string;
  onPress: () => void;
}

export interface ScreenHeaderProps {
  title?: string;
  onBack?: () => void;
  actions?: ScreenHeaderAction[];
}

export function ScreenHeader({ title, onBack, actions }: ScreenHeaderProps) {
  const router = useRouter();
  return (
    <View className="h-14 flex-row items-center justify-between bg-bg px-3">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Go back"
        hitSlop={8}
        onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/(tabs)')))}
        className="h-10 w-10 items-center justify-center rounded-pill bg-fg/8">
        <Icon name="chevron-back" size={22} className="text-fg" />
      </PressableScale>
      {title ? (
        <Text numberOfLines={1} className="flex-1 px-3 text-center text-title font-bold text-fg">
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      <View className="flex-row items-center gap-2">
        {(actions ?? []).map((a) => (
          <PressableScale
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            hitSlop={8}
            onPress={a.onPress}
            className="h-10 w-10 items-center justify-center rounded-pill bg-fg/8">
            <Icon name={a.icon} size={21} className="text-fg" />
          </PressableScale>
        ))}
        {!actions?.length ? <View className="w-10" /> : null}
      </View>
    </View>
  );
}
