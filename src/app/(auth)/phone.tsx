import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MOCK_ENABLED, MOCK_PASSWORD } from '@/api/mock';
import { Button, Field, Icon } from '@/components';
import { detectContact } from '@/lib/contact';
import { friendlyError } from '@/lib/errors';
import { CARD_SHADOW } from '@/lib/theme';
import { nextAuthRoute } from '@/lib/onboarding';
import type { ContactStatus } from '@/services/auth';
import { useSession } from '@/store/session';

/**
 * One identifier field for both login and signup.
 *
 * - Existing account with a password → the password field slides in underneath.
 * - Existing account created by OTP only → send a code.
 * - Unknown identifier → send a code and continue through registration.
 */
export default function PhoneScreen() {
  const router = useRouter();
  const requestLoginCode = useSession((s) => s.requestLoginCode);
  const checkContact = useSession((s) => s.checkContact);
  const loginWithPassword = useSession((s) => s.loginWithPassword);
  const authPending = useSession((s) => s.authPending);
  const authError = useSession((s) => s.authError);
  const clearAuthError = useSession((s) => s.clearAuthError);

  const [contact, setContact] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ContactStatus>();
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  /** The member asked for a one-time code even though a password exists. */
  const [preferCode, setPreferCode] = useState(false);

  const busy = authPending || checking;
  const askPassword = Boolean(status?.exists && status.has_password && !preferCode);

  const reset = () => {
    if (error) setError('');
    if (authError) clearAuthError();
    if (status) setStatus(undefined);
    if (password) setPassword('');
    if (preferCode) setPreferCode(false);
  };

  const submit = async () => {
    if (busy) return;
    clearAuthError();
    setError('');

    const parsed = detectContact(contact);
    if (!parsed) {
      setError('Enter a valid email or a Tunisian number, e.g. +216 20 000 000.');
      return;
    }

    // Second tap: the password field is already visible for a known account.
    if (askPassword) {
      if (password.length < 1) {
        setError('Enter your password.');
        return;
      }
      const ok = await loginWithPassword(parsed.contact, password);
      if (ok) router.replace(nextAuthRoute(useSession.getState().user) as never);
      return;
    }

    setChecking(true);
    try {
      let channel = parsed.channel;
      if (!preferCode) {
        const found = await checkContact(parsed.contact);
        setStatus(found);
        channel = found.channel;
        if (found.exists && found.has_password) return;
      }

      const sent = await requestLoginCode(parsed.contact, channel);
      if (sent) router.push('/(auth)/verify');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerClassName="flex-grow px-5 pt-2 pb-6">

          {/* Logo & branding */}
          <View className="mt-12 mb-10 items-center gap-4">
            <View
              style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
              className="h-24 w-24 items-center justify-center rounded-panel bg-navy">
              <Icon name="car-sport" size={44} className="text-accent" />
            </View>
            <View className="items-center gap-1">
              <Text className="text-display font-bold text-fg">Blasa</Text>
              <Text className="text-h font-medium text-muted">Tunisia&apos;s ride network</Text>
            </View>
            <Text className="text-center text-body text-muted max-w-xs">
              Connect with drivers heading your way.{'\n'}Use your email or phone — no username to remember.
            </Text>
          </View>

          {/* Features strip — one tonal row */}
          <View
            style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
            className="mb-8 flex-row rounded-card bg-surface px-2 py-3">
            {[
              { icon: 'shield-checkmark-outline' as const, label: 'Verified drivers' },
              { icon: 'cash-outline' as const, label: 'Fair pricing' },
              { icon: 'location-outline' as const, label: 'Nationwide routes' },
            ].map((f) => (
              <View key={f.label} className="flex-1 items-center gap-1.5 px-1">
                <Icon name={f.icon} size={20} className="text-accentStrong" />
                <Text className="text-center text-meta text-muted">{f.label}</Text>
              </View>
            ))}
          </View>

          {/* Form */}
          <View className="gap-4">
            <Field
              label="Email or phone number"
              icon="at-outline"
              keyboardType="email-address"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com or +216 20 000 000"
              value={contact}
              error={error}
              editable={!busy}
              onChangeText={(t) => {
                reset();
                setContact(t);
              }}
            />

            {askPassword ? (
              <Field
                label="Password"
                icon="lock-closed-outline"
                secureTextEntry
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                editable={!busy}
                onChangeText={(t) => {
                  if (authError) clearAuthError();
                  setPassword(t);
                }}
                onSubmitEditing={() => void submit()}
              />
            ) : null}

            <Button
              title={askPassword ? 'Log in' : 'Continue'}
              icon={askPassword ? 'log-in-outline' : 'arrow-forward-outline'}
              loading={busy}
              onPress={() => void submit()}
              block
            />

            {askPassword ? (
              <Button
                title="Use a one-time code instead"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setPreferCode(true);
                  setPassword('');
                  clearAuthError();
                }}
              />
            ) : null}

            {preferCode && status?.exists ? (
              <Button
                title="Use my password instead"
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setPreferCode(false);
                  clearAuthError();
                }}
              />
            ) : null}

            {authError ? (
              <Text accessibilityRole="alert" className="text-center text-meta text-deal">{authError}</Text>
            ) : null}

            <Text className="text-center text-meta text-faint">
              {askPassword
                ? 'Welcome back. Forgot your password? Use a one-time code instead.'
                : preferCode
                  ? 'We’ll send a 6-digit code to your email or phone, then sign you in.'
                  : 'New to Blasa? We’ll send a 6-digit code, then ask for your name and password.'}
            </Text>

            {MOCK_ENABLED ? (
              <View className="rounded-card border border-dashed border-line bg-surface/60 p-3">
                <View className="flex-row items-center gap-2">
                  <Icon name="flask-outline" size={16} className="text-warning" />
                  <Text className="font-semibold text-meta text-fg">Mock mode</Text>
                </View>
                <Text className="mt-1 text-meta text-muted">
                  Sign in with {`+21699000123`} and password {MOCK_PASSWORD}. Use any other number or email to
                  walk through signup, the code step and role selection.
                </Text>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
