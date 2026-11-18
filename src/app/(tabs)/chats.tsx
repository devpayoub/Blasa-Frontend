import { formatDistanceToNow } from 'date-fns';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, Icon, PressableScale, SkeletonRow } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { getBooking } from '@/services/bookings';
import { listConversations, listMessages } from '@/services/conversations';
import { getRide } from '@/services/rides';
import { useSession } from '@/store/session';
import type { Booking, Conversation, Message, Ride } from '@/types';

interface ChatRow {
  conversation: Conversation;
  booking: Booking | null;
  ride: Ride | null;
  last: Message | null;
}

/** One conversation per booking — the passenger and driver can chat in-app. */
export default function ChatsScreen() {
  const userId = useSession((s) => s.user?.id);
  // undefined = still loading; [] = loaded and empty.
  const [rows, setRows] = useState<ChatRow[] | undefined>(undefined);
  const loading = rows === undefined;

  const load = useCallback(() => {
    listConversations()
      .then(async (page) => {
        // The conversation payload only carries ids: walk to the booking and
        // ride for the route label, and pull the thread for a preview.
        const hydrated = await Promise.all(
          page.results.map(async (conversation): Promise<ChatRow> => {
            const booking = await getBooking(conversation.booking).catch(() => null);
            const ride = booking ? await getRide(booking.ride).catch(() => null) : null;
            const messages = await listMessages(conversation.id).catch(() => null);
            const last = messages?.results.length ? messages.results[messages.results.length - 1] : null;
            return { conversation, booking, ride, last };
          }),
        );
        hydrated.sort((a, b) => {
          const at = new Date(a.last?.created_at ?? a.conversation.created_at).getTime();
          const bt = new Date(b.last?.created_at ?? b.conversation.created_at).getTime();
          return bt - at;
        });
        setRows(hydrated);
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const renderRow = ({ item }: { item: ChatRow }) => {
    const { ride, last } = item;
    const drives = ride?.driver === userId;
    const route = ride ? `${ride.origin_label} → ${ride.destination_label}` : 'Booking chat';
    const preview = last
      ? `${last.sender === userId ? 'You: ' : ''}${last.body}`
      : 'No messages yet — say hi.';
    const when = last ? formatDistanceToNow(new Date(last.created_at), { addSuffix: true }) : '';

    return (
      <PressableScale
        onPress={() => router.push(`/chat/${item.conversation.id}` as never)}
        style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
        className="flex-row items-center gap-3 rounded-card bg-surface p-4">
        <View className="h-11 w-11 items-center justify-center rounded-pill bg-accentSoft">
          <Icon name={drives ? 'person-outline' : 'car-outline'} size={20} className="text-accentStrong" />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text numberOfLines={1} className="flex-1 font-semibold text-title text-fg">
              {route}
            </Text>
            {when ? <Text className="text-meta text-faint">{when}</Text> : null}
          </View>
          <Text numberOfLines={1} className="mt-0.5 text-body text-muted">
            {preview}
          </Text>
          <Text className="mt-0.5 text-meta text-faint">
            {drives ? 'You drive' : 'Your trip'}
          </Text>
        </View>
      </PressableScale>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <View className="px-5 pt-3">
        <Text className="text-display font-bold text-fg">Chats</Text>
      </View>
      {loading ? (
        <View className="gap-3 px-5">
          {[0, 1, 2].map((key) => (
            <SkeletonRow key={key} />
          ))}
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="No conversations"
          message="A chat opens automatically for each booking — say hi to your driver or passenger."
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.conversation.id}
          contentContainerClassName="gap-2.5 px-5 pb-24 pt-3"
          showsVerticalScrollIndicator={false}
          renderItem={renderRow}
        />
      )}
    </SafeAreaView>
  );
}
