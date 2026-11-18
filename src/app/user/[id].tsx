import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, Chip, EmptyState, ScreenHeader, Spinner, useInterestTags } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { publicProfile, tagLabel } from '@/services/users';
import type { UserPublicProfile } from '@/types';

function Stars({ score }: { score: number }) {
  return (
    <View className="flex-row items-center gap-0.5" accessibilityLabel={`${score} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Text key={n} className={n <= Math.round(score) ? 'text-body text-warning' : 'text-body text-faint'}>
          ★
        </Text>
      ))}
    </View>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <View style={[CARD_SHADOW, { borderCurve: 'continuous' }]} className="gap-3 rounded-card bg-surface p-4">
      {children}
    </View>
  );
}

/**
 * Trust profile of another participant, reachable from a ride, a booking or a request.
 * Shows only what the backend considers participant-safe: name, trust numbers, bio,
 * declared interests and (for people you shared a ride with) review comments.
 */
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<UserPublicProfile | null | undefined>(undefined);
  const [error, setError] = useState('');
  const { tags } = useInterestTags();

  const load = useCallback(() => {
    if (!id) return;
    publicProfile(id)
      .then((next) => {
        setError('');
        setProfile(next);
      })
      .catch((err) => {
        setProfile(null);
        setError(err instanceof Error ? err.message : 'Could not load this profile. Please retry.');
      });
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (profile === undefined) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Profile" />
        <Spinner className="mt-20 self-center" />
      </SafeAreaView>
    );
  }

  if (profile === null) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Profile" />
        <EmptyState
          icon="person-outline"
          title="Profile unavailable"
          message={error || 'This member cannot be shown right now.'}
          actionLabel="Try again"
          onAction={load}
        />
      </SafeAreaView>
    );
  }

  const rating = Number(profile.average_rating);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Profile" />
      <ScrollView contentContainerClassName="gap-4 px-5 pb-8 pt-3" showsVerticalScrollIndicator={false}>
        <Card>
          <View className="flex-row items-start justify-between gap-2">
            <View className="flex-1">
              <Text className="font-bold text-h text-fg">{profile.display_name}</Text>
              <Text className="mt-0.5 text-meta text-muted">
                {profile.is_driver ? 'Driver' : 'Passenger'} · Member since{' '}
                {new Date(profile.member_since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
              </Text>
            </View>
            <Badge label={profile.is_driver ? 'DRIVER' : 'PASSENGER'} tone={profile.is_driver ? 'accent' : 'soft'} />
          </View>

          <View className="flex-row items-center gap-4 border-t border-line pt-3">
            <View className="gap-0.5">
              <Stars score={rating} />
              <Text className="text-meta text-muted">
                {profile.review_count === 0
                  ? 'No reviews yet'
                  : `${rating.toFixed(1)} · ${profile.review_count} review${profile.review_count === 1 ? '' : 's'}`}
              </Text>
            </View>
            <View className="h-8 w-px bg-line" />
            <Text className="text-meta text-muted">
              {profile.completed_trips === 0
                ? 'No completed trips yet'
                : `${profile.completed_trips} completed trip${profile.completed_trips === 1 ? '' : 's'}`}
            </Text>
          </View>

          {profile.bio ? <Text className="text-body text-fg">{profile.bio}</Text> : null}

          {profile.shared_interests.length > 0 ? (
            <View className="gap-1.5">
              <Text className="text-meta text-muted">You both like</Text>
              <View className="flex-row flex-wrap gap-1.5">
                {profile.shared_interests.map((slug) => (
                  <Chip key={slug} label={tagLabel(slug, tags)} size="sm" selected />
                ))}
              </View>
            </View>
          ) : null}

          {!profile.is_self ? (
            <View className="flex-row gap-2 border-t border-line pt-3">
              <Button
                title="Report"
                icon="flag-outline"
                variant="ghost"
                size="sm"
                className="flex-1"
                onPress={() => router.push({ pathname: '/report', params: { type: 'USER', id: profile.id } })}
              />
            </View>
          ) : null}
        </Card>

        <View className="gap-2">
          <Text className="font-bold text-title text-fg">Reviews</Text>
          {!profile.reviews_visible ? (
            <Text className="text-body text-muted">
              Reviews are shown to members who shared a ride with {profile.display_name}.
            </Text>
          ) : profile.reviews.length === 0 ? (
            <Text className="text-body text-muted">No reviews yet. They appear after a completed ride.</Text>
          ) : (
            profile.reviews.map((review, index) => (
              <View
                key={`${review.created_at}-${index}`}
                style={CARD_SHADOW}
                className="gap-1 rounded-card bg-surface p-3">
                <View className="flex-row items-center justify-between gap-2">
                  <Stars score={review.score} />
                  <Text className="text-meta text-faint">{new Date(review.created_at).toLocaleDateString()}</Text>
                </View>
                {review.comment ? <Text className="text-body text-fg">{review.comment}</Text> : null}
                <Text className="text-meta text-muted">— {review.rater_display_name}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
