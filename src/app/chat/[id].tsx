import { formatDistanceToNow } from 'date-fns';
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  AppState, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View,
  type TextInputKeyPressEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { Button, EmptyState, Icon, PressableScale, ScreenHeader, Spinner } from '@/components';
import { createChatSocket } from '@/lib/chatSocket';
import { useThemeColors } from '@/lib/theme';
import { getBooking } from '@/services/bookings';
import { getConversation, listMessages, sendMessage } from '@/services/conversations';
import { getRide } from '@/services/rides';
import { useSession } from '@/store/session';
import type { AuthUser, Conversation, Message } from '@/types';

type LoadError = { title: string; message: string };
type Controls = { refresh: () => void; retry: () => void; send: () => Promise<void>; finishSend: () => void };

function loadFailure(error: unknown): LoadError {
  if (error instanceof ApiError && error.status === 404) {
    return { title: 'Chat unavailable', message: 'Chat only becomes available after payment confirmation. This conversation may also be unavailable to your account.' };
  }
  if (error instanceof ApiError && error.status === 403) {
    return { title: 'Chat access refused', message: 'You no longer have access to this chat. Refresh your session to check access again.' };
  }
  if (error instanceof ApiError && error.status === 401) {
    return { title: 'Session expired', message: 'Refresh your session or sign in again before retrying chat.' };
  }
  return { title: 'Could not load chat', message: 'Messages could not be loaded. Check your connection and try again.' };
}

function readOnlyExplanation(conversation: Conversation): string {
  if (conversation.booking_status.startsWith('CANCELLED_BY_')) {
    return 'This booking was cancelled. You can read the chat history, but cannot send new messages.';
  }
  if (['COMPLETED', 'NO_SHOW'].includes(conversation.booking_status)) {
    return 'This booking has ended. You can read the chat history, but cannot send new messages.';
  }
  return 'This chat is read-only. Sending is no longer available for this booking or account.';
}

function mergeMessages(previous: Message[], incoming: Message[], id: string): Message[] {
  const byId = new Map(previous.filter((message) => message.conversation === id).map((message) => [message.id, message]));
  for (const message of incoming) if (message.conversation === id) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** Owner/id keys prevent history, drafts and pending sends crossing account or route boundaries. */
export default function ChatScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const user = useSession((state) => state.user);
  const access = useSession((state) => state.access);
  const hydrated = useSession((state) => state.hydrated);
  const pending = useSession((state) => state.pendingContact);
  if (!hydrated) return <SafeAreaView className="flex-1 bg-bg"><Spinner className="my-10 self-center" /></SafeAreaView>;
  if (!user || !access) return <Redirect href={pending ? '/(auth)/verify' : '/(auth)/phone'} />;
  if (!id) return <SafeAreaView className="flex-1 bg-bg"><ScreenHeader title="Chat" /><EmptyState title="Chat unavailable" message="Open a conversation from a confirmed booking." /></SafeAreaView>;
  return <ChatThread key={`${user.id}:${user.role}:${id}`} id={id} user={user} access={access} />;
}

function ChatThread({ id, user, access }: { id: string; user: AuthUser; access: string }) {
  const colors = useThemeColors();
  const [messages, setMessages] = useState<Message[] | undefined>();
  const [conversation, setConversation] = useState<Conversation>();
  const [title, setTitle] = useState('Chat');
  const [draft, setDraft] = useState('');
  const draftRef = useRef('');
  const [blockedAccess, setBlockedAccess] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [checking, setChecking] = useState(true);
  const [canSend, setCanSend] = useState(false);
  const [connected, setConnected] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [loadError, setLoadError] = useState<LoadError>();
  const [sendError, setSendError] = useState('');
  const [restriction, setRestriction] = useState('');
  const controls = useRef<Controls | null>(null);
  // These latches survive focus changes. A rejected token cannot become usable simply by refocusing.
  const expiredAccess = useRef<string | null>(null);
  const deniedAccess = useRef<string | null>(null);

  useFocusEffect(useCallback(() => {
    let mounted = true;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    let generation = 0;
    let sendGeneration = 0;
    let allowed = false;
    let socket: ReturnType<typeof createChatSocket> | null = null;
    const current = () => mounted && useSession.getState().access === access && useSession.getState().user === user;
    const blocked = () => expiredAccess.current === access || deniedAccess.current === access;
    const stopSocket = () => { socket?.close(); socket = null; };
    const suspend = () => {
      generation += 1;
      allowed = false;
      stopSocket();
      if (current()) { setCanSend(false); setConnected(false); }
    };

    const refreshSession = async () => {
      if (!current()) return;
      setChecking(true);
      await useSession.getState().refreshMe();
      // Token/user changes trigger a fresh verification effect; never reconnect using the rejected token.
      if (!current()) return;
      setChecking(false);
      setRestriction('Your session has not renewed yet. Sign in again to restore chat access. Your draft is kept.');
    };

    const rejectAccess = (auth: boolean) => {
      if (!current()) return;
      if (auth) expiredAccess.current = access;
      else deniedAccess.current = access;
      setBlockedAccess(access);
      sendGeneration += 1;
      suspend();
      setRestriction(auth
        ? 'Your session expired. Refresh your session or sign in again to continue. Your draft is kept.'
        : 'Sending is paused because chat access was refused. Your draft is kept.');
      if (auth) void refreshSession();
      else void recheck();
    };

    const recheck = async () => {
      if (!current() || !foreground) return;
      suspend();
      const ticket = generation;
      const valid = () => current() && foreground && generation === ticket;
      setChecking(true);
      setLoadError(undefined);
      setLiveError('');
      if (expiredAccess.current === access) {
        setChecking(false);
        setRestriction('Your session expired. Refresh your session or sign in again before retrying chat.');
        return;
      }
      try {
        // Verify permissions before history, a composer, or a live connection is exposed.
        const detail = await getConversation(id);
        if (!valid()) return;
        setConversation(detail);
        const page = await listMessages(id);
        if (!valid()) return;
        setMessages((previous) => mergeMessages(previous ?? [], page.results, id));
        setRestriction(!detail.can_send ? readOnlyExplanation(detail) : blocked()
          ? 'Sending is paused because your account’s chat access was refused. Refresh your session before retrying.' : '');
        allowed = detail.can_send === true && !blocked();
        setCanSend(allowed);
        setChecking(false);
        // The title is optional metadata, never a substitute for successful access/history loading.
        void getBooking(detail.booking).then((booking) => valid() ? getRide(booking.ride) : undefined).then((ride) => {
          if (valid() && ride) setTitle(`${ride.origin_label} → ${ride.destination_label}`);
        }).catch(() => undefined);
        if (!allowed) return;
        socket = createChatSocket(id, access, {
          onOpen: () => { if (valid() && allowed) { setConnected(true); setLiveError(''); } },
          onClose: (code) => {
            if (!valid()) return;
            setConnected(false);
            if ([4401, 4403, 1008].includes(code)) rejectAccess(code === 4401);
            else setLiveError('Live chat disconnected. You can still send messages; refresh to see replies.');
          },
          onError: (message) => { if (valid()) { setConnected(false); setLiveError(message); } },
          onMessage: (frame) => {
            if (valid() && allowed) setMessages((previous) => mergeMessages(previous ?? [], [frame.message], id));
          },
        });
      } catch (error) {
        if (!valid()) return;
        if (error instanceof ApiError && error.status === 401) {
          expiredAccess.current = access;
          setBlockedAccess(access);
          void refreshSession();
        } else if (error instanceof ApiError && error.status === 403) {
          deniedAccess.current = access;
          setBlockedAccess(access);
        }
        setLoadError(loadFailure(error));
        setChecking(false);
      }
    };

    const send = async () => {
      const original = draftRef.current;
      const body = original.trim();
      if (!current() || !foreground || !allowed || blocked() || sendingRef.current || !body) return;
      if (original.length > 2000) { setSendError('Keep your message within 2,000 characters.'); return; }
      sendingRef.current = true;
      const ticket = sendGeneration;
      const valid = () => current() && ticket === sendGeneration;
      setSending(true);
      setSendError('');
      try {
        const message = await sendMessage(id, body);
        if (!valid()) return;
        setMessages((previous) => mergeMessages(previous ?? [], [message], id));
        // Do not erase edits made while the request was in flight.
        if (draftRef.current === original) { draftRef.current = ''; setDraft(''); }
      } catch (error) {
        if (!valid()) return;
        setSendError(error instanceof ApiError ? error.message : 'Could not send your message. Check your connection and try again.');
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) rejectAccess(error.status === 401);
      } finally {
        sendingRef.current = false;
        // A token rotation can replace this focus scope while its REST send is still pending.
        controls.current?.finishSend();
      }
    };

    controls.current = {
      send,
      finishSend: () => { if (current()) setSending(false); },
      refresh: () => { void recheck(); },
      retry: () => { if (blocked()) void refreshSession(); else void recheck(); },
    };
    setSending(sendingRef.current);
    // Synchronous invalidation closes the old socket before React processes a session change.
    const unsubscribe = useSession.subscribe((next, previous) => {
      if (next.access !== previous.access || next.user !== previous.user) {
        generation += 1;
        sendGeneration += 1;
        allowed = false;
        stopSocket();
        controls.current = null;
        if (mounted) { setCanSend(false); setConnected(false); setChecking(true); }
      }
    });
    const appState = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) void recheck();
      else suspend();
    });
    void recheck();
    return () => {
      mounted = false;
      generation += 1;
      sendGeneration += 1;
      allowed = false;
      controls.current = null;
      stopSocket();
      unsubscribe();
      appState.remove();
    };
  }, [access, id, user]));

  const onKeyPress = (event: TextInputKeyPressEvent) => {
    if (Platform.OS !== 'web') return;
    const native = event.nativeEvent as unknown as { key: string; shiftKey?: boolean };
    if (native.key !== 'Enter' || native.shiftKey) return;
    event.preventDefault();
    void controls.current?.send();
  };
  const editable = canSend && !checking && !loadError;
  const tokenBlocked = blockedAccess === access;
  const sendDisabled = sending || !draft.trim() || draft.length > 2000 || !editable;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title={title} />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loadError ? (
          <EmptyState icon="chatbubble-ellipses-outline" title={loadError.title} message={loadError.message}
            actionLabel={tokenBlocked ? 'Refresh session' : 'Try again'} onAction={() => controls.current?.retry()} />
        ) : messages === undefined && tokenBlocked && !checking ? (
          <EmptyState icon="lock-closed-outline" title="Chat paused" message="Refresh your session or sign in again before retrying chat."
            actionLabel="Refresh session" onAction={() => controls.current?.retry()} />
        ) : messages === undefined ? (
          <View className="flex-1 items-center justify-center"><Spinner /><Text className="mt-3 text-body text-muted">Loading chat…</Text></View>
        ) : messages.length === 0 ? (
          <EmptyState icon="chatbubble-ellipses-outline" title={editable ? 'Say hi' : 'No messages'}
            message={editable ? 'Coordinate your pickup here. Messages are only visible to this booking’s participants.' : 'There are no messages in this conversation.'} />
        ) : (
          <FlatList data={messages.slice().reverse()} keyExtractor={(message) => message.id} inverted
            className="flex-1" contentContainerClassName="px-4 py-2" showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const mine = item.sender === user.id;
              const date = new Date(item.created_at);
              return (
                <View className={`mb-3 max-w-[80%] ${mine ? 'self-end' : 'self-start'}`}>
                  <View className={`rounded-2xl px-4 py-3 ${mine ? 'bg-navy' : 'bg-surface'}`}>
                    <Text className={`text-body ${mine ? 'text-cream' : 'text-fg'}`}>{item.body}</Text>
                  </View>
                  <Text className={`mt-1 text-meta text-muted ${mine ? 'text-right' : ''}`}>
                    {Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : 'Message'}
                  </Text>
                </View>
              );
            }} />
        )}

        {checking ? <Text accessibilityLiveRegion="polite" className="px-4 py-2 text-center text-meta text-muted">Checking chat access…</Text> : null}
        {restriction && !checking ? (
          <View className="gap-2 border-t border-line bg-surface px-4 py-3">
            <View className="flex-row items-start gap-2"><Icon name="lock-closed-outline" size={18} className="text-muted" />
              <Text accessibilityLiveRegion="polite" className="flex-1 text-body text-muted">{restriction}</Text></View>
            {tokenBlocked && conversation?.can_send !== false ? <Button title="Refresh session" variant="secondary" onPress={() => controls.current?.retry()} /> : null}
          </View>
        ) : null}
        {tokenBlocked ? <Button title="Sign in again" variant="ghost" onPress={() => router.push('/(auth)/phone')} /> : null}
        {editable ? (
          <View className="flex-row items-center gap-2 border-t border-line bg-surface px-4 py-2">
            <Icon name={connected ? 'chatbubble-ellipses-outline' : 'cloud-offline-outline'} size={18} className="text-muted" />
            <Text accessibilityLiveRegion="polite" className="flex-1 text-meta text-muted">{connected ? 'Live updates on' : liveError || 'Connecting to live chat. You can still send messages.'}</Text>
            <Button title="Refresh" variant="ghost" onPress={() => controls.current?.refresh()} />
          </View>
        ) : null}
        {sendError ? <Text accessibilityRole="alert" className="bg-surface px-4 py-2 text-body text-deal">{sendError} Your draft is kept.</Text> : null}
        {editable ? (
          <View className="gap-2 bg-surface px-4 pb-3 pt-2">
            <Text className="font-medium text-meta text-muted">Message</Text>
            <View className="flex-row items-end gap-2">
              <TextInput accessibilityLabel="Message" accessibilityHint="Up to 2,000 characters"
                className="max-h-32 min-h-12 flex-1 rounded-3xl border border-line bg-bg px-4 py-3 text-body text-fg"
                placeholder="Write a message…" placeholderTextColor={colors.muted} multiline maxLength={2000}
                submitBehavior={Platform.OS === 'web' ? 'newline' : 'submit'} value={draft}
                onChangeText={(value) => { draftRef.current = value; setDraft(value); }}
                onSubmitEditing={() => void controls.current?.send()} onKeyPress={onKeyPress} />
              <PressableScale accessibilityRole="button" accessibilityLabel="Send message"
                accessibilityState={{ disabled: sendDisabled, busy: sending }} disabled={sendDisabled}
                onPress={() => void controls.current?.send()}
                className={`h-12 w-12 items-center justify-center rounded-pill ${sendDisabled ? 'bg-fg/10' : 'bg-accent'}`}>
                {sending ? <Spinner size={18} /> : <Icon name="arrow-up" size={24} className={sendDisabled ? 'text-muted' : 'text-onAccent'} />}
              </PressableScale>
            </View>
            <Text className="text-right text-meta text-muted">{draft.length} / 2,000</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
