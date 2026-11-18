import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge, Button, EmptyState, ScreenHeader, Spinner } from '@/components';
import { CARD_SHADOW } from '@/lib/theme';
import { pickUpload, uploadFile } from '@/lib/upload';
import { becomeDriver, me } from '@/services/users';
import { confirmUpload, listDocuments, requestDownloadUrl, requestUploadUrl } from '@/services/verification';
import { useSession } from '@/store/session';
import type { Page, VerificationDocument } from '@/types';

const statusLabels: Record<VerificationDocument['status'], string> = {
  PENDING: 'Awaiting review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  NEEDS_MORE_DOCUMENTS: 'More documents requested',
  SUPERSEDED: 'Replaced by a newer document',
};

const decisionLabels = {
  APPROVE: 'Approved', REJECT: 'Rejected', REQUEST_MORE: 'More documents requested',
  SUPERSEDE: 'Replaced', REVOKE: 'Approval revoked',
};

export default function VerificationScreen() {
  const user = useSession((s) => s.user);
  const userId = user?.id;
  const [documents, setDocuments] = useState<Page<VerificationDocument>>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [docType, setDocType] = useState<'CIN' | 'CARTE_GRISE'>('CIN');
  const [progress, setProgress] = useState('');
  const busy = useRef(false);

  const load = useCallback(() => {
    if (!userId) return Promise.resolve();
    return Promise.all([listDocuments(page), me()]).then(([result, updated]) => {
      setDocuments(result);
      setLoadError('');
      useSession.setState({ user: updated });
    }).catch((err) => {
      setLoadError(err instanceof Error ? err.message : 'Could not load documents. Please retry.');
    }).finally(() => setLoading(false));
  }, [page, userId]);

  useEffect(() => { void load(); }, [load]);

  const upload = async () => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setMessage('');
    setProgress('Choosing file…');
    let declared = false;
    try {
      const selected = await pickUpload(['application/pdf', 'image/jpeg', 'image/png'], 10 * 1024 * 1024);
      if (!selected) return;
      setProgress('Preparing upload…');
      const grant = await requestUploadUrl(docType, selected.name, selected.contentType, selected.size);
      declared = true;
      setProgress('Uploading file…');
      await uploadFile(grant.upload_url, selected.body, selected.contentType);
      setProgress('Checking uploaded file…');
      await confirmUpload(grant.document_id);
      setMessage('Upload checked. Your document is awaiting staff review.');
    } catch (err) {
      setError(`${err instanceof Error ? err.message : 'Could not upload document.'}${declared ? ' The upload is not confirmed. Choose the file again to retry.' : ''}`);
    } finally {
      busy.current = false;
      setProgress('');
      if (declared) await load();
    }
  };

  const preview = async (document: VerificationDocument) => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setMessage('');
    setProgress('Opening private preview…');
    try {
      const result = await requestDownloadUrl(document.id);
      await openBrowserAsync(result.download_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open document. Please retry.');
    } finally {
      busy.current = false;
      setProgress('');
    }
  };

  const upgrade = async () => {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setProgress('Enabling driver mode…');
    try {
      useSession.setState({ user: await becomeDriver() });
      router.replace('/vehicles');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable driver mode.');
    } finally {
      busy.current = false;
      setProgress('');
    }
  };

  if (!user) return <SafeAreaView className="flex-1 bg-bg"><EmptyState icon="shield-checkmark-outline" title="Log in to view verification" actionLabel="Log in" onAction={() => router.replace('/(auth)/phone')} /></SafeAreaView>;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <ScreenHeader title="Verification centre" />
      <ScrollView contentContainerClassName="gap-4 px-5 pb-8 pt-3">
        <View style={CARD_SHADOW} className="gap-3 rounded-card bg-surface p-4">
          <Text className="font-bold text-h text-fg">Identity and vehicle documents</Text>
          <Text className="text-body text-muted">An approved CIN unlocks driver mode. Each vehicle needs its own approved carte grise before you can offer rides.</Text>
          <Text className="text-meta text-muted">Private files are visible only to you and authorised staff. Uploads may be unavailable pending legal approval or storage setup.</Text>
          <Badge label={user.is_verified ? 'Identity approved' : 'Identity not approved yet'} tone={user.is_verified ? 'accent' : 'soft'} className="self-start" />
          <View className="flex-row flex-wrap gap-2">
            {(['CIN', 'CARTE_GRISE'] as const).map((type) => (
              <Button key={type} title={type === 'CIN' ? 'CIN' : 'Carte grise'} variant={type === docType ? 'primary' : 'secondary'} accessibilityState={{ selected: type === docType }} disabled={Boolean(progress)} onPress={() => setDocType(type)} />
            ))}
          </View>
          <Text className="text-meta text-muted">PDF, JPEG or PNG · up to 10 MB. Use synthetic documents in development.</Text>
          <Button title={progress || `Choose ${docType === 'CIN' ? 'CIN' : 'carte grise'} file`} icon="cloud-upload-outline" loading={Boolean(progress)} onPress={() => void upload()} />
          {error ? <Text accessibilityRole="alert" className="text-body text-deal">{error}</Text> : null}
          {message ? <Text accessibilityLiveRegion="polite" className="text-body text-accentStrong">{message}</Text> : null}
        </View>

        <View className="flex-row items-center justify-between gap-2">
          <Text className="font-bold text-title text-fg">Your documents</Text>
          <Button title="Refresh status" variant="secondary" size="sm" disabled={Boolean(progress) || loading} onPress={() => { setLoading(true); void load(); }} />
        </View>
        {loading ? <Spinner className="self-center" /> : null}
        {loadError ? <Text accessibilityRole="alert" className="text-body text-deal">{loadError}</Text> : null}
        {!loading && !loadError && documents?.count === 0 ? <EmptyState icon="document-text-outline" title="No documents yet" message="Choose a CIN or carte grise file above. Review starts only after the upload is checked." /> : null}
        {documents?.results.map((document) => (
          <View key={document.id} style={CARD_SHADOW} className="gap-3 rounded-card bg-surface p-4">
            <Text className="font-semibold text-title text-fg">{document.doc_type === 'CIN' ? 'CIN' : 'Carte grise'} · {document.id.slice(0, 8)}</Text>
            <Badge label={!document.uploaded_at && document.status === 'PENDING' ? 'Upload not completed' : statusLabels[document.status]} tone={document.status === 'APPROVED' ? 'accent' : 'soft'} className="self-start" />
            <Text className="text-meta text-muted">Submitted {new Date(document.created_at).toLocaleString()}</Text>
            {!document.uploaded_at ? <Text className="text-body text-muted">This file has not been confirmed. Choose the file again above to submit a new upload.</Text> : null}
            {document.rejection_reason ? <Text className="text-body text-fg">Staff feedback: {document.rejection_reason}</Text> : null}
            {document.history.map((review, index) => (
              <View key={`${review.timestamp}-${index}`} className="gap-1 border-t border-line pt-2">
                <Text className="font-semibold text-meta text-fg">{decisionLabels[review.decision]} · {new Date(review.timestamp).toLocaleString()}</Text>
                {review.reason ? <Text className="text-body text-muted">{review.reason}</Text> : null}
              </View>
            ))}
            {document.uploaded_at ? <Button title="View private document" icon="document-text-outline" variant="secondary" disabled={Boolean(progress)} onPress={() => void preview(document)} /> : null}
          </View>
        ))}
        {documents && documents.count > 0 ? (
          <View className="gap-2">
            <Text className="text-meta text-muted">Page {page} · {documents.results.length} of {documents.count} documents</Text>
            <View className="flex-row gap-2">
              <Button title="Previous page" variant="secondary" disabled={!documents.previous || loading || Boolean(progress)} onPress={() => { setLoading(true); setPage(page - 1); }} className="flex-1" />
              <Button title="Next page" variant="secondary" disabled={!documents.next || loading || Boolean(progress)} onPress={() => { setLoading(true); setPage(page + 1); }} className="flex-1" />
            </View>
          </View>
        ) : null}
        {user.role === 'PASSENGER' ? (
          <>
            <Text className="text-body text-muted">{user.is_verified ? 'Your identity is approved. You can now enable driver mode and add a vehicle.' : 'Driver mode stays locked until staff approve your CIN. Refresh after your review.'}</Text>
            <Button title="Become a driver" icon="car-outline" disabled={!user.is_verified || Boolean(progress)} onPress={() => void upgrade()} />
          </>
        ) : user.role === 'DRIVER' ? <Button title="My vehicles" icon="car-outline" variant="secondary" onPress={() => router.push('/vehicles')} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
