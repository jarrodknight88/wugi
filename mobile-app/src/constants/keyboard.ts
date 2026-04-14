// ─────────────────────────────────────────────────────────────────────
// Wugi — keyboard.ts
// Shared keyboard toolbar constants and context.
// Lives here to avoid circular imports between App.tsx and screens.
// ─────────────────────────────────────────────────────────────────────
import { createContext, useContext, useRef } from 'react';
import type { TextInput } from 'react-native';

// The nativeID used by InputAccessoryView in App.tsx
// and inputAccessoryViewID on all TextInputs
export const KB_ACCESSORY_ID = 'wugi-kb';

// Shared ref registry — screens register their field refs here
// so the toolbar's ⬆⬇ buttons can focus the prev/next field
export type KBFieldRefs = {
  fields: React.RefObject<TextInput>[];
};

export const KBContext = createContext<{
  register: (refs: React.RefObject<TextInput>[]) => void;
  focusPrev: () => void;
  focusNext: () => void;
} | null>(null);

export function useKBContext() {
  return useContext(KBContext);
}
