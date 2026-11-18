import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field, Icon, ScreenHeader } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { useSession } from '@/store/session';

/** Step 2 of 3: the name and password that finish the OTP-created account. */
export default function DetailsScreen() {
  const router = useRouter();
  const user = useSession((s) => s.user);
  const setPendingRegistration = useSession((s) => s.setPendingRegistration);

  const [fullName, setFullName] = useState(user?.profile?.full_name ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ name?: string; password?: string; confirm?: string }>({});

  if (!user) return <Redirect href="/(auth)/phone" />;
  if (user.profile?.full_name?.trim()) return <Redirect href="/start" />;

  const submit = () => {
    const next: typeof errors = {};
    const name = fullName.trim().replace(/\s+/g, ' ');
    if (name.length < 2) next.name = 'Enter your full name.';
    if (password.length < 8) next.password = 'Use at least 8 characters.';
    else if (/^\d+$/.test(password)) next.password = 'Use letters as well as numbers.';
    if (confirm !== password) next.confirm = 'Passwords don’t match.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPendingRegistration({ fullName: name, password });
    router.push('/(auth)/role');
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScreenHeader title="Your details" />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="px-5 pb-8 pt-2">
          <View className="mb-6 flex-row items-center gap-2">
            {[1, 2, 3].map((step) => (
              <View
                key={step}
                className={`h-1.5 flex-1 rounded-pill ${step <= 2 ? 'bg-accent' : 'bg-line'}`}
              />
            ))}
          </View>

          <Text className="text-h font-bold text-fg">Almost there</Text>
          <Text className="mt-1 text-body text-muted">
            Your contact is verified. Add your name and a password so you can sign in faster next time.
          </Text>

          <View className="mt-6 gap-4">
            <Field
              label="Full name"
              icon="person-outline"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Amine Trabelsi"
              value={fullName}
              error={errors.name}
              onChangeText={(t) => {
                setErrors((e) => ({ ...e, name: undefined }));
                setFullName(t);
              }}
            />
            <Field
              label="Password"
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete="new-password"
              placeholder="At least 8 characters"
              value={password}
              error={errors.password}
              onChangeText={(t) => {
                setErrors((e) => ({ ...e, password: undefined, confirm: undefined }));
                setPassword(t);
              }}
            />
            <Field
              label="Confirm password"
              icon="lock-closed-outline"
              secureTextEntry
              autoComplete="new-password"
              placeholder="Repeat your password"
              value={confirm}
              error={errors.confirm}
              onChangeText={(t) => {
                setErrors((e) => ({ ...e, confirm: undefined }));
                setConfirm(t);
              }}
              onSubmitEditing={submit}
            />
            <Button title="Continue" icon="arrow-forward-outline" onPress={submit} block />
          </View>

          <View
            style={[CARD_SHADOW, { borderCurve: 'continuous' }]}
            className="mt-8 flex-row gap-3 rounded-card bg-surface p-4">
            <Icon name="shield-checkmark-outline" size={20} className="text-accentStrong" />
            <Text className="flex-1 text-meta text-muted">
              Your password is stored hashed. Phone, email and documents are never shown to other members.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
