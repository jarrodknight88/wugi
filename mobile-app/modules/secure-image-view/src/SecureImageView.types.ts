import type { ViewProps } from 'react-native';

// Emitted once after mount: tells JS whether the private secure-canvas layer was
// obtained on this iOS version (secure:true → capture-protected) or we fell back
// to normal rendering (secure:false → NOT protected, but still visible/zoomable).
export type SecureStateEvent = { secure: boolean };

export type SecureImageViewProps = ViewProps & {
  /** Remote image URL. Required. */
  uri: string;
  /** Max pinch-zoom scale. Optional; native default is 4.0. */
  maxZoomScale?: number;
  /** Fires once with whether capture-protection is active on this device. */
  onSecureStateChange?: (event: { nativeEvent: SecureStateEvent }) => void;
};
