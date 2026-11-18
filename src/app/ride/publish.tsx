import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PointPicker, type Place } from '@/components/point-picker';
import { Button, Chip, EmptyState, Field, InterestPicker, PressableScale, ScreenHeader, Spinner } from '@/components';
import { createVehicle, listVehicles } from '@/services/vehicles';
import { publishRide } from '@/services/rides';
import { useSession } from '@/store/session';
import { ATMOSPHERES, type Atmosphere, type Vehicle } from '@/types';

const NOTES_MAX = 500;

/** Driver: publish a ride. Requires a bookable vehicle. */
export default function PublishRideScreen() {
  const user = useSession((s) => s.user);
  // undefined = still loading; [] = no bookable vehicles.
  const [vehicles, setVehicles] = useState<Vehicle[] | undefined>(undefined);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [originLabel, setOriginLabel] = useState('');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [departure, setDeparture] = useState('');
  const [seats, setSeats] = useState('3');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [atmosphere, setAtmosphere] = useState<Atmosphere | ''>('');
  const [preferred, setPreferred] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const loading = vehicles === undefined;

  const load = useCallback(() => {
    listVehicles()
      .then((page) => {
        const bookable = page.results.filter((v) => v.is_bookable);
        setVehicles(bookable);
        setVehicleId(bookable[0]?.id ?? null);
      })
      .catch(() => setVehicles([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New driver without a vehicle: inline vehicle creation first.
  const [veh, setVeh] = useState({ make: '', model: '', color: '', plate_number: '', seats: '4' });
  const addVehicle = async () => {
    setError('');
    try {
      const created = await createVehicle({
        make: veh.make.trim(),
        model: veh.model.trim(),
        color: veh.color.trim(),
        plate_number: veh.plate_number.trim(),
        seats: Number(veh.seats) || 4,
      });
      await load();
      setVehicleId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add vehicle');
    }
  };

  const submit = async () => {
    setError('');
    if (!vehicleId || !origin || !destination) {
      setError('Pick a vehicle and both points on the map');
      return;
    }
    const departureDate = new Date(departure);
    if (!originLabel.trim() || !destinationLabel.trim() || Number.isNaN(departureDate.getTime())) {
      setError('Fill labels and departure time (e.g. 2026-11-20 08:30)');
      return;
    }
    if (!/^\d+(\.\d{1,3})?$/.test(price.trim())) {
      setError('Price must be a TND amount, e.g. 12.500');
      return;
    }
    if (notes.trim().length > NOTES_MAX) {
      setError(`Notes can be up to ${NOTES_MAX} characters`);
      return;
    }
    setSubmitting(true);
    try {
      const ride = await publishRide({
        origin: origin,
        origin_label: originLabel.trim(),
        destination: destination,
        destination_label: destinationLabel.trim(),
        departure_at: departureDate.toISOString(),
        seats_total: Number(seats) || 1,
        price_per_seat: price.trim(),
        vehicle: vehicleId,
        notes: notes.trim(),
        atmosphere,
        preferred_interests: preferred,
      });
      router.replace(`/ride/${ride.id}` as never);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publishing failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (user?.role !== 'DRIVER') {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Offer a ride" />
        <EmptyState
          icon="car-sport-outline"
          title="Driver mode required"
          message="Verify your CIN, then use “Become a driver” in your Account tab."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
        <ScreenHeader title="Offer a ride" />
        <Spinner className="mt-20 self-center" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Offer a ride" />

      <ScrollView contentContainerClassName="px-5 pb-8" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {vehicles.length === 0 ? (
          <View className="mt-2 gap-3">
            <Text className="text-body text-muted">Add your vehicle first (Carte Grise verified ones are bookable).</Text>
            <Field label="Make" value={veh.make} onChangeText={(t) => setVeh({ ...veh, make: t })} placeholder="e.g. Isuzu" />
            <Field label="Model" value={veh.model} onChangeText={(t) => setVeh({ ...veh, model: t })} placeholder="e.g. D-Max" />
            <Field label="Color" value={veh.color} onChangeText={(t) => setVeh({ ...veh, color: t })} placeholder="e.g. White" />
            <Field label="Plate number" value={veh.plate_number} onChangeText={(t) => setVeh({ ...veh, plate_number: t })} placeholder="e.g. 123 TN 4567" />
            <Field label="Seats" value={veh.seats} onChangeText={(t) => setVeh({ ...veh, seats: t.replace(/\D/g, '') })} keyboardType="number-pad" />
            <Button title="Save vehicle" icon="add-circle-outline" onPress={() => void addVehicle()} block />
          </View>
        ) : (
          <View className="mt-2 gap-4">
            <View className="flex-row flex-wrap gap-2">
              {vehicles.map((v) => (
                <Button
                  key={v.id}
                  title={`${v.make} ${v.model}`}
                  icon="car-outline"
                  variant={v.id === vehicleId ? 'primary' : 'secondary'}
                  size="sm"
                  onPress={() => setVehicleId(v.id)}
                />
              ))}
            </View>

            <PointPicker title="Origin" point={origin} onPick={(p) => { setOrigin(p); if (!originLabel) setOriginLabel(p.label); }} />
            <Field label="Origin label" value={originLabel} onChangeText={setOriginLabel} placeholder="e.g. Tunis — Lac 1" />

            <PointPicker title="Destination" point={destination} onPick={(p) => { setDestination(p); if (!destinationLabel) setDestinationLabel(p.label); }} />
            <Field label="Destination label" value={destinationLabel} onChangeText={setDestinationLabel} placeholder="e.g. Sousse — Centre" />

            <Field label="Departure (YYYY-MM-DD HH:MM)" icon="time-outline" value={departure} onChangeText={setDeparture} placeholder="2026-11-20 08:30" />
            <Field label="Seats offered" icon="people-outline" keyboardType="number-pad" value={seats} onChangeText={(t) => setSeats(t.replace(/\D/g, ''))} />
            <Field label="Price per seat (TND)" icon="cash-outline" keyboardType="decimal-pad" value={price} onChangeText={setPrice} placeholder="12.500" />
            <Field
              label={`Notes for passengers (optional, ${notes.length}/${NOTES_MAX})`}
              icon="document-text-outline"
              multiline
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. Pickup at the Lac 1 roundabout, one small bag each"
            />

            <View className="gap-2">
              <Text className="font-semibold text-meta text-muted">Ride atmosphere (optional)</Text>
              <View className="flex-row flex-wrap gap-2">
                {ATMOSPHERES.map((a) => (
                  <PressableScale
                    key={a.value}
                    accessibilityRole="radio"
                    accessibilityLabel={a.label}
                    accessibilityState={{ checked: atmosphere === a.value }}
                    onPress={() => setAtmosphere(atmosphere === a.value ? '' : a.value)}>
                    <Chip label={a.label} selected={atmosphere === a.value} size="sm" />
                  </PressableScale>
                ))}
              </View>
            </View>
            <View className="gap-2">
              <Text className="font-semibold text-meta text-muted">Topics you enjoy on the road (optional)</Text>
              <InterestPicker selected={preferred} onChange={setPreferred} disabled={submitting} />
            </View>

            {error ? <Text className="text-meta text-deal">{error}</Text> : null}
            <Button title="Publish ride" icon="paper-plane-outline" loading={submitting} onPress={() => void submit()} block />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
