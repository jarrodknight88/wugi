// ─────────────────────────────────────────────────────────────────────
// Wugi — useDoubleTap
// Lightweight double-tap detector. Returns a press handler you can pass
// to a TouchableOpacity/Pressable's onPress; it fires the onDoubleTap
// callback if two taps land within `delay` ms of each other, and the
// onSingleTap callback otherwise (debounced by `delay`).
// ─────────────────────────────────────────────────────────────────────
import { useRef } from 'react';

type Options = {
  onDoubleTap: () => void;
  onSingleTap?: () => void;
  delay?: number;        // ms window between taps. Default 280.
};

export function useDoubleTap({ onDoubleTap, onSingleTap, delay = 280 }: Options) {
  const lastTap   = useRef(0);
  const singleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTap.current < delay) {
      // Double tap — cancel any pending single-tap fire and run double.
      if (singleTimer.current) { clearTimeout(singleTimer.current); singleTimer.current = null; }
      lastTap.current = 0;
      onDoubleTap();
      return;
    }
    lastTap.current = now;
    if (onSingleTap) {
      // Defer the single-tap fire by `delay` to give a second tap room.
      singleTimer.current = setTimeout(() => {
        singleTimer.current = null;
        onSingleTap();
      }, delay);
    }
  };

  return handlePress;
}
