import { Text, View } from 'react-native';

import { cn } from '@/lib/cn';
import { tagLabel } from '@/services/users';
import type { UserSummary } from '@/types';
import { Icon } from './Icon';
import { useInterestTags } from './InterestPicker';

export function trustLabel(summary: UserSummary): string {
  const rating = Number(summary.average_rating);
  const trips = summary.completed_trips;
  const parts = [rating > 0 ? `★ ${rating.toFixed(1)}` : 'No ratings yet'];
  parts.push(trips === 0 ? 'no trips yet' : trips === 1 ? '1 trip' : `${trips} trips`);
  return parts.join(' · ');
}

function SharedInterests({ slugs }: { slugs: string[] }) {
  const { tags } = useInterestTags();
  return (
    <View className="flex-row items-center gap-1.5 pl-6">
      <Icon name="sparkles-outline" size={14} className="text-accentStrong" />
      <Text numberOfLines={1} className="flex-1 text-meta text-accentStrong">
        {`You both like ${slugs.map((slug) => tagLabel(slug, tags)).join(', ')}`}
      </Text>
    </View>
  );
}

/** Name, rating, trip count and interests in common — what other members may see, never contact details. */
export function PersonSummary({ summary, className }: { summary: UserSummary; className?: string }) {
  const shared = summary.shared_interests ?? [];
  return (
    <View className={cn('gap-0.5', className)}>
      <View className="flex-row items-center gap-1.5">
        <Icon name="person-circle-outline" size={18} className="text-muted" />
        <Text numberOfLines={1} className="flex-1 text-meta text-muted">
          <Text className="font-semibold text-fg">{summary.display_name}</Text>
          {`  ${trustLabel(summary)}`}
        </Text>
      </View>
      {shared.length > 0 ? <SharedInterests slugs={shared} /> : null}
    </View>
  );
}
