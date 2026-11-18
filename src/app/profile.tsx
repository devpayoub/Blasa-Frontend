import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, EmptyState, Field, InterestPicker, ScreenHeader } from '@/components';
import { normalizeContact } from '@/lib/contact';
import { CARD_SHADOW } from '@/lib/theme';
import { pickUpload, uploadFile } from '@/lib/upload';
import { requestContactCode, verifyContactCode, type ContactChannel } from '@/services/auth';
import { avatarDownloadUrl, confirmAvatarUpload, requestAvatarUpload, updateMe } from '@/services/users';
import { useSession } from '@/store/session';

export default function ProfileScreen() {
  const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
  const user = useSession((s) => s.user);
  const [fullName, setFullName] = useState(user?.profile?.full_name ?? '');
  const [bio, setBio] = useState(user?.profile?.bio ?? '');
  const [interests, setInterests] = useState<string[]>(user?.profile?.interests ?? []);
  const [language, setLanguage] = useState(user?.preferred_language ?? 'fr');
  const [saving, setSaving] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [photo, setPhoto] = useState<string>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [channel, setChannel] = useState<ContactChannel>('EMAIL');
  const [contact, setContact] = useState('');
  const [pendingContact, setPendingContact] = useState<{ channel: ContactChannel; contact: string }>();
  const [code, setCode] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const avatarKey = user?.profile?.avatar_key;

  useEffect(() => {
    if (!avatarKey) return;
    let active = true;
    avatarDownloadUrl().then((result) => { if (active) setPhoto(result.download_url); }).catch(() => undefined);
    return () => { active = false; };
  }, [avatarKey]);

  const save = async () => {
    if (saving || photoPending) return;
    setError('');
    setMessage('');
    if (!fullName.trim()) { setError('Enter your full name'); return; }
    setSaving(true);
    try {
      const updated = await updateMe({ profile: { full_name: fullName.trim(), bio: bio.trim(), interests }, preferred_language: language });
      useSession.setState({ user: updated });
      if (onboarding === '1') router.replace('/(tabs)');
      else setMessage('Profile saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save profile');
    } finally { setSaving(false); }
  };

  const uploadPhoto = async () => {
    if (photoPending || saving) return;
    setError('');
    setMessage('');
    try {
      const selected = await pickUpload(['image/jpeg', 'image/png'], 5 * 1024 * 1024);
      if (!selected) return;
      setPhotoPending(true);
      const upload = await requestAvatarUpload(selected.name, selected.contentType, selected.size);
      await uploadFile(upload.upload_url, selected.body, selected.contentType);
      useSession.setState({ user: await confirmAvatarUpload(upload.upload_token) });
      setMessage('Profile photo updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo');
    } finally { setPhotoPending(false); }
  };

  const requestContact = async () => {
    if (contactBusy) return;
    setError('');
    setMessage('');
    const normalized = normalizeContact(contact, channel);
    if (!normalized) { setError(channel === 'EMAIL' ? 'Enter a valid email address' : 'Enter a Tunisian phone number'); return; }
    setContactBusy(true);
    try {
      await requestContactCode(channel, normalized);
      setPendingContact({ channel, contact: normalized });
      setCode('');
      setMessage('Check your contact for a verification code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send code');
    } finally { setContactBusy(false); }
  };

  const confirmContact = async () => {
    if (!pendingContact || contactBusy) return;
    setError('');
    setMessage('');
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code'); return; }
    setContactBusy(true);
    try {
      const updated = await verifyContactCode(pendingContact.channel, pendingContact.contact, code);
      useSession.setState({ user: updated });
      setPendingContact(undefined);
      setContact('');
      setCode('');
      setMessage('Contact verified and saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify contact');
    } finally { setContactBusy(false); }
  };

  if (!user) return <SafeAreaView className="flex-1 bg-bg"><EmptyState icon="person-outline" title="Log in to edit your profile" actionLabel="Log in" onAction={() => router.replace('/(auth)/phone')} /></SafeAreaView>;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title={onboarding === '1' ? 'Welcome to Blasa' : 'Edit profile'} />
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-8 pt-3">
          <View style={CARD_SHADOW} className="gap-4 rounded-card bg-surface p-4">
            <Text className="font-bold text-h text-fg">{onboarding === '1' ? 'Let people know who you are' : 'Your profile'}</Text>
            <Text className="text-body text-muted">Your name and bio help your travel companions recognise you. Identity approval is separate.</Text>
            {photo ? <Image source={photo} accessibilityLabel="Your profile photo" style={{ width: 80, height: 80, borderRadius: 40 }} /> : null}
            <Button title={photoPending ? 'Uploading photo…' : 'Choose profile photo'} icon="camera-outline" variant="secondary" loading={photoPending} disabled={saving} onPress={() => void uploadPhoto()} />
            <Text className="text-meta text-muted">JPEG or PNG · up to 5 MB</Text>
            <Field label="Full name" value={fullName} onChangeText={setFullName} maxLength={150} autoComplete="name" />
            <Field label="Bio (optional)" value={bio} onChangeText={setBio} multiline maxLength={500} textAlignVertical="top" />
            <View className="gap-2">
              <Text className="font-semibold text-meta text-muted">Interests (optional)</Text>
              <InterestPicker selected={interests} onChange={setInterests} disabled={saving} />
              <Text className="text-meta text-faint">Drivers and passengers only see the interests you have in common.</Text>
            </View>
            <Text className="font-semibold text-meta text-muted">Preferred language</Text>
            <View className="flex-row flex-wrap gap-2">
              {([['fr', 'Français'], ['ar', 'العربية'], ['en', 'English']] as const).map(([value, label]) => (
                <Button key={value} title={label} variant={language === value ? 'primary' : 'secondary'} accessibilityState={{ selected: language === value }} onPress={() => setLanguage(value)} />
              ))}
            </View>
            <Button title={onboarding === '1' ? 'Continue to Blasa' : 'Save profile'} loading={saving} disabled={photoPending} onPress={() => void save()} block />
          </View>
          <View style={CARD_SHADOW} className="gap-3 rounded-card bg-surface p-4">
            <Text className="font-bold text-title text-fg">Login contacts</Text>
            <Text className="text-body text-muted">Phone: {user.phone_number || 'Not linked'}{user.phone_verified_at ? ' · verified' : ''}</Text>
            <Text className="text-body text-muted">Email: {user.email || 'Not linked'}{user.email_verified_at ? ' · verified' : ''}</Text>
            <Text className="text-meta text-muted">A new contact is saved only after verification. Existing accounts are never merged.</Text>
            {pendingContact ? (
              <>
                <Text className="text-body text-fg">Verify {pendingContact.contact}</Text>
                <Field label="Contact verification code" value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} code keyboardType="number-pad" maxLength={6} />
                <Button title="Verify and save contact" loading={contactBusy} onPress={() => void confirmContact()} />
                <Button title="Use a different contact" variant="ghost" disabled={contactBusy} onPress={() => { setPendingContact(undefined); setCode(''); }} />
              </>
            ) : (
              <>
                <View className="flex-row gap-2">
                  {(['EMAIL', 'PHONE'] as const).map((value) => <Button key={value} title={value === 'EMAIL' ? 'Email' : 'Phone'} variant={channel === value ? 'primary' : 'secondary'} disabled={contactBusy} accessibilityState={{ selected: channel === value }} onPress={() => { setChannel(value); setContact(''); }} />)}
                </View>
                <Field label={channel === 'EMAIL' ? 'New email address' : 'New phone number'} value={contact} onChangeText={setContact} keyboardType={channel === 'EMAIL' ? 'email-address' : 'phone-pad'} autoCapitalize="none" autoCorrect={false} />
                <Button title="Send contact verification code" variant="secondary" loading={contactBusy} onPress={() => void requestContact()} />
              </>
            )}
          </View>
          {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}
          {message ? <Text accessibilityLiveRegion="polite" className="text-body text-accentStrong">{message}</Text> : null}
          <Button title="Identity verification" icon="shield-checkmark-outline" variant="secondary" onPress={() => router.push('/verification')} />
          {user.role === 'DRIVER' ? <Button title="My vehicles" icon="car-outline" variant="secondary" onPress={() => router.push('/vehicles')} /> : null}
          {onboarding === '1' ? <Button title="Log out" variant="ghost" onPress={() => { useSession.getState().signOut(); router.replace('/(auth)/phone'); }} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
