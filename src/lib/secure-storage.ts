/**
 * Platform-split storage for zustand's persist middleware. Tokens live in
 * expo-secure-store on native (encrypted, keychain/keystore backed); on web
 * SecureStore is unavailable, so we fall back to localStorage.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { StateStorage } from 'zustand/middleware';

export const persistentStorage: StateStorage =
  Platform.OS === 'web'
    ? {
        getItem: (name) => (typeof window === 'undefined' ? null : window.localStorage.getItem(name)),
        setItem: (name, value) => {
          if (typeof window !== 'undefined') window.localStorage.setItem(name, value);
          return undefined;
        },
        removeItem: (name) => {
          if (typeof window !== 'undefined') window.localStorage.removeItem(name);
          return undefined;
        },
      }
    : {
        getItem: (name) => SecureStore.getItemAsync(name),
        setItem: (name, value) => SecureStore.setItemAsync(name, value),
        removeItem: (name) => SecureStore.deleteItemAsync(name),
      };
