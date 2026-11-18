import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { Button, EmptyState, Field, PressableScale, ScreenHeader, Spinner } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { createVehicle, listVehicles, updateVehicle } from '@/services/vehicles';
import { listDocuments } from '@/services/verification';
import { useSession } from '@/store/session';
import type { AuthUser, Page, Vehicle, VerificationDocument, VerificationDocumentStatusEnum } from '@/types';

const REGISTRATION_STATUS: Record<VerificationDocumentStatusEnum, string> = {
  PENDING: 'Pending review — not eligible',
  APPROVED: 'Approved — registration eligible',
  REJECTED: 'Rejected — not eligible',
  NEEDS_MORE_DOCUMENTS: 'More documents needed — not eligible',
  SUPERSEDED: 'Superseded — not eligible',
};

type VehicleForm = {
  make: string;
  model: string;
  color: string;
  plate_number: string;
  seats: string;
  carte_grise: string | null;
  is_active: boolean | undefined;
};
type FieldErrors = Partial<Record<'make' | 'model' | 'color' | 'plate_number' | 'seats', string>>;

function blankForm(): VehicleForm {
  return { make: '', model: '', color: '', plate_number: '', seats: '', carte_grise: null, is_active: undefined };
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const labels: Record<string, string> = {
      make: 'Make', model: 'Model', color: 'Color', plate_number: 'Plate number',
      seats: 'Passenger seats', carte_grise: 'Registration', is_active: 'Active status',
    };
    const envelope = error.body as { error?: { detail?: unknown } } | undefined;
    const body = envelope?.error && typeof envelope.error === 'object' ? envelope.error.detail : error.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const details = Object.entries(body).flatMap(([field, value]) => {
        const messages = Array.isArray(value) ? value : [value];
        return messages.filter((message): message is string => typeof message === 'string')
          .map((message) => `${labels[field] ? `${labels[field]}: ` : ''}${message.charAt(0).toUpperCase()}${message.slice(1)}`);
      });
      if (details.length) return details.join('\n');
    }
    return error.message;
  }
  if (error instanceof Error) {
    if (/network|fetch|abort/i.test(error.message)) return 'Cannot reach the server. Check your connection and retry.';
    return error.message;
  }
  return 'Could not complete this request. Please retry.';
}

function registrationStatus(document: VerificationDocument): string {
  if (document.status === 'PENDING' && !document.uploaded_at) return 'Upload not confirmed — not eligible';
  return REGISTRATION_STATUS[document.status] ?? 'Unknown status — eligibility not confirmed';
}

function registrationLabel(document: VerificationDocument): string {
  const date = new Date(document.created_at);
  const created = Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString();
  return `Carte grise · ${created} · ${document.id.slice(0, 8)}`;
}

export default function VehiclesScreen() {
  const user = useSession((state) => state.user);
  if (user?.role !== 'DRIVER') {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="My vehicles" />
        <EmptyState icon="car-outline" title="Drivers only" message="Sign in with a driver account to manage your own vehicles." />
      </SafeAreaView>
    );
  }
  // Remount owner-specific state when the signed-in driver changes.
  return <DriverVehicles key={user.id} user={user} />;
}

function DriverVehicles({ user }: { user: AuthUser }) {
  const router = useRouter();
  const ownerId = user.id;
  const [vehiclePage, setVehiclePage] = useState<Page<Vehicle> | null>(null);
  const [documentPage, setDocumentPage] = useState<Page<VerificationDocument> | null>(null);
  const [vehicleNumber, setVehicleNumber] = useState(1);
  const [documentNumber, setDocumentNumber] = useState(1);
  const [picked, setPicked] = useState<VerificationDocument | null>(null);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [vehiclesError, setVehiclesError] = useState('');
  const [documentsError, setDocumentsError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [form, setForm] = useState<VehicleForm>(blankForm);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const mounted = useRef(false);
  // Synchronous locks also cover rapid double presses before React re-renders.
  const pending = useRef(new Set<string>());
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const isCurrentOwner = useCallback(() => {
    const current = useSession.getState().user;
    return mounted.current && !!ownerId && current?.id === ownerId && current.role === 'DRIVER';
  }, [ownerId]);

  const loadVehicles = useCallback(() => {
    if (!isCurrentOwner()) return;
    const key = `${ownerId}:vehicles`;
    if (pending.current.has(key) || pending.current.has(`${ownerId}:save`)) return;
    pending.current.add(key);
    void listVehicles(vehicleNumber).then((page) => {
      if (isCurrentOwner()) {
        setVehiclePage(page);
        setVehiclesError('');
      }
    }).catch((error: unknown) => {
      if (isCurrentOwner()) setVehiclesError(errorMessage(error));
    }).finally(() => {
      pending.current.delete(key);
      if (isCurrentOwner()) setVehiclesLoading(false);
    });
  }, [ownerId, isCurrentOwner, vehicleNumber]);

  const loadDocuments = useCallback(() => {
    if (!isCurrentOwner()) return;
    const key = `${ownerId}:documents`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    void listDocuments(documentNumber).then((page) => {
      if (isCurrentOwner()) {
        setDocumentPage(page);
        setDocumentsError('');
      }
    }).catch((error: unknown) => {
      if (isCurrentOwner()) setDocumentsError(errorMessage(error));
    }).finally(() => {
      pending.current.delete(key);
      if (isCurrentOwner()) setDocumentsLoading(false);
    });
  }, [ownerId, isCurrentOwner, documentNumber]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { loadVehicles(); }, [loadVehicles]);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  function goToVehiclePage(page: number) {
    if (!isCurrentOwner() || page < 1 || pending.current.has(`${ownerId}:vehicles`) || pending.current.has(`${ownerId}:save`)) return;
    setVehiclesLoading(true);
    setVehiclesError('');
    setNotice('');
    setVehicleNumber(page);
  }

  function goToDocumentPage(page: number) {
    if (!isCurrentOwner() || page < 1 || pending.current.has(`${ownerId}:documents`) || pending.current.has(`${ownerId}:save`)) return;
    setDocumentsLoading(true);
    setDocumentsError('');
    setDocumentNumber(page);
  }

  function refreshVehicles() {
    if (!isCurrentOwner() || pending.current.has(`${ownerId}:vehicles`) || pending.current.has(`${ownerId}:save`)) return;
    setVehiclesLoading(true);
    setVehiclesError('');
    void loadVehicles();
  }

  function refreshDocuments() {
    if (!isCurrentOwner() || pending.current.has(`${ownerId}:documents`) || pending.current.has(`${ownerId}:save`)) return;
    setDocumentsLoading(true);
    setDocumentsError('');
    void loadDocuments();
  }

  const registrations = documentPage?.results.filter((document) => document.doc_type === 'CARTE_GRISE') ?? [];
  const selectedRegistration = registrations.find((document) => document.id === form.carte_grise)
    ?? (picked?.id === form.carte_grise ? picked : undefined);
  const selectedOffPage = !!selectedRegistration && !registrations.some((document) => document.id === selectedRegistration.id);
  const attachedNotLoaded = editing?.carte_grise && editing.carte_grise !== picked?.id && !registrations.some((document) => document.id === editing.carte_grise)
    ? editing.carte_grise : null;

  function openForm(vehicle: Vehicle | null) {
    if (!isCurrentOwner() || saving || vehiclesLoading) return;
    setEditing(vehicle);
    setPicked(null);
    setForm(vehicle ? {
      make: vehicle.make, model: vehicle.model, color: vehicle.color ?? '',
      plate_number: vehicle.plate_number, seats: String(vehicle.seats),
      carte_grise: vehicle.carte_grise ?? null, is_active: vehicle.is_active,
    } : blankForm());
    setFieldErrors({});
    setSaveError('');
    setNotice('');
    setFormOpen(true);
    scroll.current?.scrollTo({ y: 0, animated: true });
  }

  function changeField<K extends keyof VehicleForm>(key: K, value: VehicleForm[K]) {
    if (saving) return;
    setForm((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
    setSaveError('');
  }

  async function saveVehicle() {
    if (!ownerId || !isCurrentOwner() || !vehiclePage || vehiclesLoading) return;
    const key = `${ownerId}:save`;
    if (pending.current.has(key) || pending.current.has(`${ownerId}:vehicles`)) return;
    const errors: FieldErrors = {};
    const input = {
      make: form.make.trim(), model: form.model.trim(), color: form.color.trim(),
      plate_number: form.plate_number.trim(), seats: Number(form.seats.trim()), carte_grise: form.carte_grise,
    };
    for (const [field, label, limit] of [
      ['make', 'Make', 50], ['model', 'Model', 50], ['plate_number', 'Plate number', 20],
    ] as const) {
      if (!input[field]) errors[field] = `${label} is required.`;
      else if (input[field].length > limit) errors[field] = `Use at most ${limit} characters.`;
    }
    if (input.color.length > 30) errors.color = 'Use at most 30 characters.';
    if (!/^\d+$/.test(form.seats.trim()) || !Number.isInteger(input.seats) || input.seats < 1 || input.seats > 32767) {
      errors.seats = 'Enter a whole number from 1 to 32767.';
    }
    setFieldErrors(errors);
    setSaveError('');
    if (Object.keys(errors).length) return;
    // A previously attached document may be outside the first page. Preserve it,
    // but never allow a new arbitrary ID that was not an owned picker choice.
    if (input.carte_grise && input.carte_grise !== editing?.carte_grise && !selectedRegistration) {
      setSaveError('Choose one of your loaded carte grise documents, or no registration.');
      return;
    }
    pending.current.add(key);
    setSaving(true);
    try {
      const saved = editing
        ? await updateVehicle(editing.id, { ...input, ...(form.is_active === undefined ? {} : { is_active: form.is_active }) })
        : await createVehicle(input);
      if (!isCurrentOwner()) return;
      setVehiclePage((previous) => previous ? {
        ...previous,
        count: previous.count + (editing ? 0 : 1),
        results: editing ? previous.results.map((vehicle) => vehicle.id === saved.id ? saved : vehicle)
          : [saved, ...previous.results.filter((vehicle) => vehicle.id !== saved.id)],
      } : previous);
      setFormOpen(false);
      setEditing(null);
      setNotice(editing ? 'Vehicle updated.' : 'Vehicle added. Check its eligibility below.');
      scroll.current?.scrollTo({ y: 0, animated: true });
    } catch (error) {
      if (isCurrentOwner()) setSaveError(errorMessage(error));
    } finally {
      pending.current.delete(key);
      if (isCurrentOwner()) setSaving(false);
    }
  }

  function publishBlockedReason(vehicle: Vehicle): string | null {
    const document = registrations.find((item) => item.id === vehicle.carte_grise);
    const reasons: string[] = [];
    if (vehicle.is_active === false) reasons.push('Vehicle is inactive. Activate it in Edit vehicle.');
    if (!vehicle.carte_grise) reasons.push('No registration attached. Attach an approved carte grise.');
    else if (document && document.status !== 'APPROVED') {
      reasons.push(`Registration: ${registrationStatus(document)}.${document.rejection_reason ? ` ${document.rejection_reason}` : ''}`);
    } else if (vehicle.is_verified !== true) {
      reasons.push('Registration approval is not confirmed by the server. Check verification and refresh.');
    }
    if (vehicle.is_bookable !== true && !reasons.length) reasons.push('The server has not marked this vehicle eligible. Refresh to check its status.');
    if (!user?.is_verified) reasons.push('Complete driver verification before publishing.');
    return reasons.length ? reasons.join(' ') : null;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="My vehicles" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 32 }}>
          <View className="gap-5 px-5 pt-3">
            <View className="gap-2">
              <Text accessibilityRole="header" className="text-h font-bold text-fg">Your vehicles</Text>
              <Text className="text-body text-muted">Manage passenger seats and registration. Only an active vehicle with an approved carte grise is eligible for rides.</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button title="Add vehicle" icon="add" disabled={!vehiclePage || vehiclesLoading || saving || formOpen} onPress={() => openForm(null)} />
                <Button title="Refresh vehicles" variant="secondary" loading={vehiclesLoading} disabled={saving} onPress={refreshVehicles} />
              </View>
              <Button title="Upload / view verification" variant="ghost" disabled={saving} onPress={() => router.push('/verification')} />
            </View>

            {notice ? <Text accessibilityLiveRegion="polite" className="text-body font-semibold text-accentStrong">{notice}</Text> : null}

            {formOpen ? (
              <View className="gap-4 rounded-card border border-line bg-surface p-5" style={CARD_SHADOW}>
                <Text accessibilityRole="header" className="text-title font-bold text-fg">{editing ? 'Edit vehicle' : 'Add vehicle'}</Text>
                <Field label="Make" placeholder="e.g. Toyota" value={form.make} onChangeText={(value) => changeField('make', value)} maxLength={50} error={fieldErrors.make} editable={!saving} autoCapitalize="words" returnKeyType="next" />
                <Field label="Model" placeholder="e.g. Corolla" value={form.model} onChangeText={(value) => changeField('model', value)} maxLength={50} error={fieldErrors.model} editable={!saving} autoCapitalize="words" returnKeyType="next" />
                <Field label="Color (optional)" value={form.color} onChangeText={(value) => changeField('color', value)} maxLength={30} error={fieldErrors.color} editable={!saving} returnKeyType="next" />
                <Field label="Plate number" placeholder="e.g. 123 TU 4567" value={form.plate_number} onChangeText={(value) => changeField('plate_number', value)} maxLength={20} error={fieldErrors.plate_number} editable={!saving} autoCapitalize="characters" autoCorrect={false} returnKeyType="next" />
                <Field label="Passenger seats" placeholder="e.g. 4" value={form.seats} onChangeText={(value) => changeField('seats', value)} error={fieldErrors.seats} editable={!saving} keyboardType="number-pad" inputMode="numeric" returnKeyType="done" />
                <Text className="text-meta text-muted">Passenger seats, excluding the driver. Whole numbers from 1 to 32767.</Text>

                {editing ? (
                  <View className="gap-2">
                    <Text className="text-body font-semibold text-fg">Vehicle availability</Text>
                    {form.is_active === undefined ? <Text className="text-meta text-muted">Active status was not returned. Choose a status to change it.</Text> : null}
                    <View className="flex-row flex-wrap gap-2">
                      <Button title="Active" variant={form.is_active === true ? 'soft' : 'secondary'} disabled={saving} accessibilityState={{ selected: form.is_active === true, disabled: saving }} onPress={() => changeField('is_active', true)} />
                      <Button title="Inactive" variant={form.is_active === false ? 'soft' : 'secondary'} disabled={saving} accessibilityState={{ selected: form.is_active === false, disabled: saving }} onPress={() => changeField('is_active', false)} />
                    </View>
                    <Text className="text-meta text-muted">Save changes to apply this status. Activation does not verify registration.</Text>
                  </View>
                ) : null}

                <View className="gap-3">
                  <Text accessibilityRole="header" className="text-body font-semibold text-fg">Registration attachment (optional)</Text>
                  <Text className="text-meta text-muted">Choose your own carte grise. Any review status can be attached; only approval makes registration eligible.</Text>
                  <Button title="No registration / detach" variant={form.carte_grise === null ? 'soft' : 'secondary'} disabled={saving} accessibilityState={{ selected: form.carte_grise === null, disabled: saving }} onPress={() => changeField('carte_grise', null)} />
                  {documentsLoading ? <View className="flex-row items-center gap-2"><Spinner /><Text className="text-body text-muted">Loading your documents…</Text></View> : null}
                  {documentsError ? <Text accessibilityLiveRegion="polite" className="text-body text-deal">{documentsError}</Text> : null}
                  <Button title={documentsError ? 'Retry documents' : 'Refresh documents'} variant="secondary" disabled={saving || documentsLoading} onPress={refreshDocuments} />
                  {documentPage ? <Text className="text-meta text-muted">Documents page {documentNumber} · {documentPage.results.length} of {documentPage.count} owned documents; {registrations.length} carte grise on this page.</Text> : null}
                  {documentPage && (documentPage.previous || documentPage.next) ? (
                    <View className="flex-row flex-wrap gap-2">
                      <Button title="Previous documents" variant="secondary" disabled={!documentPage.previous || documentsLoading || saving} onPress={() => goToDocumentPage(documentNumber - 1)} />
                      <Button title="Next documents" variant="secondary" disabled={!documentPage.next || documentsLoading || saving} onPress={() => goToDocumentPage(documentNumber + 1)} />
                    </View>
                  ) : null}
                  {!documentsLoading && !documentsError && !registrations.length ? <Text className="text-body text-muted">No carte grise on this page. Upload one in verification, then refresh documents.</Text> : null}
                  {attachedNotLoaded ? (
                    <Button title="Keep currently attached registration" variant={form.carte_grise === attachedNotLoaded ? 'soft' : 'secondary'} disabled={saving} accessibilityState={{ selected: form.carte_grise === attachedNotLoaded, disabled: saving }} onPress={() => changeField('carte_grise', attachedNotLoaded)} />
                  ) : null}
                  {attachedNotLoaded && form.carte_grise === attachedNotLoaded ? <Text className="text-meta text-muted">Attached document {attachedNotLoaded}. Its review details are not loaded; saving will preserve the attachment.</Text> : null}
                  {registrations.map((document) => {
                    const selected = form.carte_grise === document.id;
                    return (
                      <PressableScale key={document.id} accessibilityRole="button" accessibilityLabel={`${registrationLabel(document)}. ${registrationStatus(document)}`} accessibilityState={{ selected, disabled: saving }} disabled={saving} onPress={() => { changeField('carte_grise', document.id); setPicked(document); }} className={`min-h-12 gap-1 rounded-input border p-3 ${selected ? 'border-accent bg-accentSoft' : 'border-line bg-surface'} ${saving ? 'opacity-40' : ''}`}>
                        <Text className="text-body font-semibold text-fg">{registrationLabel(document)}</Text>
                        <Text className="text-meta text-muted">{selected ? 'Selected · ' : ''}{registrationStatus(document)}</Text>
                      </PressableScale>
                    );
                  })}
                  {selectedRegistration ? (
                    <Text accessibilityLiveRegion="polite" className="text-body text-muted">{selectedOffPage ? `Selected ${registrationLabel(selectedRegistration)} (another page). ` : ''}{registrationStatus(selectedRegistration)}.{selectedRegistration.rejection_reason ? ` Reason: ${selectedRegistration.rejection_reason}` : ''} Attachment changes take effect after saving.</Text>
                  ) : null}
                  <Button title="Upload registration in verification" variant="ghost" disabled={saving} onPress={() => router.push('/verification')} />
                </View>

                {saveError ? <Text accessibilityLiveRegion="polite" className="text-body text-deal">{saveError}</Text> : null}
                <Button title={editing ? 'Save changes' : 'Create vehicle'} block loading={saving} disabled={vehiclesLoading} onPress={() => void saveVehicle()} />
                <Button title="Cancel" variant="secondary" block disabled={saving} onPress={() => { setFormOpen(false); setSaveError(''); }} />
              </View>
            ) : null}

            {vehiclesLoading ? <View className="flex-row items-center justify-center gap-3 py-6"><Spinner /><Text className="text-body text-muted">Loading your vehicles…</Text></View> : null}
            {vehiclesError ? (
              <View className="gap-3 rounded-card border border-line bg-surface p-5">
                <Text accessibilityLiveRegion="polite" className="text-body text-deal">{vehiclesError}</Text>
                {vehiclePage ? <Text className="text-meta text-muted">Showing previously loaded vehicles. Refresh to check their latest eligibility.</Text> : null}
                <Button title="Retry vehicles" variant="secondary" disabled={vehiclesLoading || saving} onPress={refreshVehicles} />
              </View>
            ) : null}
            {vehiclePage ? <Text className="text-meta text-muted">Vehicles page {vehicleNumber} · showing {vehiclePage.results.length} of {vehiclePage.count} vehicles.</Text> : null}
            {vehiclePage && (vehiclePage.previous || vehiclePage.next) ? (
              <View className="flex-row flex-wrap gap-2">
                <Button title="Previous vehicles" variant="secondary" disabled={!vehiclePage.previous || vehiclesLoading || saving || formOpen} onPress={() => goToVehiclePage(vehicleNumber - 1)} />
                <Button title="Next vehicles" variant="secondary" disabled={!vehiclePage.next || vehiclesLoading || saving || formOpen} onPress={() => goToVehiclePage(vehicleNumber + 1)} />
              </View>
            ) : null}
            {vehiclePage && !vehiclesLoading && !vehiclePage.results.length && !formOpen ? <EmptyState icon="car-outline" title="No vehicles yet" message="Add your vehicle, then attach its carte grise to make it eligible for rides." actionLabel="Add your first vehicle" onAction={() => openForm(null)} /> : null}

            {vehiclePage?.results.map((vehicle) => {
              const document = registrations.find((item) => item.id === vehicle.carte_grise);
              const blocked = publishBlockedReason(vehicle);
              const canPublish = vehicle.is_bookable === true && !blocked;
              return (
                <View key={vehicle.id} className="gap-3 rounded-card border border-line bg-surface p-5" style={CARD_SHADOW}>
                  <Text accessibilityRole="header" className="text-title font-bold text-fg">{vehicle.make} {vehicle.model}</Text>
                  <Text className="text-body text-muted">{vehicle.plate_number} · {vehicle.seats} passenger {vehicle.seats === 1 ? 'seat' : 'seats'}{vehicle.color ? ` · ${vehicle.color}` : ''}</Text>
                  <Text className="text-meta font-semibold text-fg">{vehicle.is_active === true ? 'Active' : vehicle.is_active === false ? 'Inactive' : 'Active status unavailable'} · {vehicle.is_bookable === true ? 'Vehicle eligible' : 'Vehicle not eligible'}</Text>
                  <Text className="text-body text-muted">Registration: {document ? registrationStatus(document) : !vehicle.carte_grise ? 'Not attached' : vehicle.is_verified === true ? 'Approved (server confirmed)' : 'Attached; approval not confirmed. Review details are not on the loaded document page.'}</Text>
                  {blocked ? <Text className="text-body text-deal">Publish blocked: {blocked}</Text> : null}
                  <Button title={`Edit vehicle ${vehicle.plate_number}`} variant="secondary" disabled={saving || vehiclesLoading || formOpen} onPress={() => openForm(vehicle)} />
                  <Button title="Publish a ride" disabled={!canPublish || saving || vehiclesLoading || !!vehiclesError || formOpen} onPress={() => { if (canPublish && isCurrentOwner()) router.push('/ride/publish'); }} />
                  {!user?.is_verified ? <Button title="Complete driver verification" variant="ghost" disabled={saving} onPress={() => router.push('/verification')} /> : null}
                </View>
              );
            })}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
