import * as React from 'react';
import { Platform } from 'react-native';
import { Image } from 'expo-image';
import { requireNativeView } from 'expo';
import type { SecureImageViewProps } from './SecureImageView.types';

// iOS-only native view. The capture-exclusion technique (hidden secure
// UITextField canvas) has no Android equivalent here, so on Android we render the
// existing expo-image <Image> via Platform.select — Android is left unaffected.
const NativeSecureImageView =
  Platform.OS === 'ios'
    ? requireNativeView<SecureImageViewProps>('SecureImageView')
    : null;

export function SecureImageView(props: SecureImageViewProps) {
  if (Platform.OS === 'ios' && NativeSecureImageView) {
    return <NativeSecureImageView {...props} />;
  }
  // Android / fallback: plain expo-image. NO capture protection on Android.
  return (
    <Image
      source={{ uri: props.uri }}
      style={props.style as any}
      contentFit="contain"
      cachePolicy="memory-disk"
    />
  );
}

export type { SecureImageViewProps } from './SecureImageView.types';
