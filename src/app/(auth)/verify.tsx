import { Redirect, router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, ScreenHeader } from '@/components';
import { nextAuthRoute } from '@/lib/onboarding';
import { useSession } from '@/store/session';

export default function VerifyScreen() {
  const pending = useSession((s) => s.pendingContact);
  const user = useSession((s) => s.user);
  const proofAccepted = useSession((s) => Boolean(s.access && s.pendingContact));
  const verifyLoginCode = useSession((s) => s.verifyLoginCode);
  const requestLoginCode = useSession((s) => s.requestLoginCode);
  const authPending = useSession((s) => s.authPending);
  const authError = useSession((s) => s.authError);
  const clearAuthError = useSession((s) => s.clearAuthError);

  const shown = pending?.contact ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const codeRef = useRef<string>('');

  const submit = async (value: string) => {
    if (authPending) return;
    clearAuthError();
    if (!proofAccepted && !/^\d{6}$/.test(value)) {
      setError('Enter the 6-digit code');
      return;
    }
    setError('');
    const ok = await verifyLoginCode(value);
    if (ok) {
      router.replace(nextAuthRoute(useSession.getState().user) as never);
    } else {
      setCode('');
      codeRef.current = '';
    }
  };

  const onCodeChange = (raw: string) => {
    const next = raw.replace(/\D/g, '').slice(0, 6);
    if (error) setError('');
    if (authError) clearAuthError();
    setCode(next);
    if (next.length === 6 && next !== codeRef.current) {
      codeRef.current = next;
      void submit(next);
    }
  };

  const resend = async () => {
    clearAuthError();
    setResending(true);
    if (pending) await requestLoginCode(shown, pending.channel);
    setCode('');
    codeRef.current = '';
    setResending(false);
  };

  if (!pending) return <Redirect href={(user ? nextAuthRoute(user) : '/(auth)/phone') as never} />;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader title="Verification code" />
        <View className="flex-1 px-5 pt-6">
          <Text className="text-h font-bold text-fg">{proofAccepted ? 'Finish signing in' : 'Enter your code'}</Text>
          {proofAccepted ? (
            <Text className="mt-1 text-body text-muted">Your contact is verified. Retry loading your account when the connection returns.</Text>
          ) : (
            <Text className="mt-1 text-body text-muted">
              Enter the 6-digit code sent {pending.channel === 'EMAIL' ? 'by email' : 'by SMS'} to{' '}
              <Text className="font-semibold text-fg">{shown}</Text>. Codes expire after 5 minutes. Resending replaces the previous code.
            </Text>
          )}

          <View className="mt-6 gap-4">
            {!proofAccepted ? <Field
              label="6-digit code"
              icon="keypad-outline"
              keyboardType="number-pad"
              maxLength={6}
              code
              value={code}
              error={error}
              onChangeText={onCodeChange}
            /> : null}
            <Button
              title={proofAccepted ? 'Retry sign-in' : 'Log in'}
              icon="log-in-outline"
              loading={authPending}
              onPress={() => void submit(code)}
              block
            />
            {!proofAccepted ? <Button
              title="Resend code"
              variant="ghost"
              loading={resending}
              disabled={authPending}
              onPress={() => void resend()}
            /> : null}
            <Button title="Use a different contact" variant="ghost" disabled={authPending || resending} onPress={() => { useSession.getState().signOut(); router.replace('/(auth)/phone'); }} />
            {authError ? <Text accessibilityRole="alert" className="text-center text-meta text-deal">{authError}</Text> : null}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
