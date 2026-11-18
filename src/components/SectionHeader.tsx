import { Text, View } from 'react-native';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
}

export function SectionHeader({ title, subtitle, onSeeAll, seeAllLabel = 'See all' }: SectionHeaderProps) {
  return (
    <View className="flex-row items-end justify-between px-5 pb-3 pt-5">
      <View className="flex-1 pr-3">
        <Text className="font-bold text-h text-fg">{title}</Text>
        {subtitle ? <Text className="mt-0.5 text-body text-muted">{subtitle}</Text> : null}
      </View>
      {onSeeAll ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${seeAllLabel} ${title}`}
          onPress={onSeeAll}
          className="flex-row items-center gap-0.5">
          <Text className="font-semibold text-body text-accentStrong">{seeAllLabel}</Text>
          <Icon name="chevron-forward" size={16} className="text-accentStrong" />
        </PressableScale>
      ) : null}
    </View>
  );
}
