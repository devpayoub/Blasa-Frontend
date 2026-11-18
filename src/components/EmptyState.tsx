import { Text, View } from 'react-native';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon = 'navigate-outline', title, message, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-8 py-16">
      <View className="h-20 w-20 items-center justify-center rounded-3xl bg-accentSoft">
        <Icon name={icon} size={36} className="text-accentStrong" />
      </View>
      <View className="items-center gap-2">
        <Text className="text-center font-bold text-h text-fg">{title}</Text>
        {message ? <Text className="text-center text-body text-muted">{message}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} className="mt-1" />
      ) : null}
    </View>
  );
}
