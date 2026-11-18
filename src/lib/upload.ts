import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import { MOCK_ENABLED } from '@/api/mock';

export async function pickUpload(types: string[], maxBytes: number) {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset.mimeType || !types.includes(asset.mimeType)) throw new Error('Choose a supported file type');
  const size = asset.size ?? asset.file?.size;
  if (!size || size > maxBytes) throw new Error(`Choose a file smaller than ${maxBytes / 1024 / 1024} MB`);
  const body = Platform.OS === 'web'
    ? asset.file ?? await (await fetch(asset.uri)).blob()
    : new (await import('expo-file-system')).File(asset.uri);
  return { name: asset.name, contentType: asset.mimeType, size, body };
}

export async function uploadFile(url: string, body: Blob, contentType: string) {
  // Mock storage accepts the file instantly; nothing leaves the device.
  if (MOCK_ENABLED) return;
  const send = Platform.OS === 'web' ? fetch : (await import('expo/fetch')).fetch;
  let response;
  try {
    response = await send(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body });
  } catch {
    throw new Error('Unable to reach file storage. Check your connection and try again.');
  }
  if (!response.ok) throw new Error(`Upload failed (${response.status}). Please try again.`);
}
