// ─────────────────────────────────────────────────────────────────────
// Wugi — Typography
//
// PP Neue Montreal (Pangram Pangram) is the brand typeface. Files live in
// assets/fonts/ and are registered two ways (see App.tsx + app.json):
//   • runtime  — useFonts() in App.tsx (works on the existing native build)
//   • native   — expo-font config plugin (embedded on the next prebuild)
//
// In React Native a custom `fontFamily` carries the weight — `fontWeight`
// is ignored once a named family is set — so reference the weight-specific
// family directly rather than pairing a family with a numeric weight.
//
// Design mapping (from the Claude Design handoff):
//   Bold (700)  → headers / display
//   Book (400)  → body
//   Medium (500)→ mid-weight
// Letterpress eyebrow labels intentionally use SYSTEM mono (Menlo), not a
// custom font — matching the design.
// ─────────────────────────────────────────────────────────────────────
import { Platform } from 'react-native';

export const FONTS = {
  display:        'PPNeueMontreal-Bold',           // headers / display (700)
  bold:           'PPNeueMontreal-Bold',
  medium:         'PPNeueMontreal-Medium',         // mid-weight (500)
  body:           'PPNeueMontreal-Book',           // body (400)
  thin:           'PPNeueMontreal-Thin',
  italic:         'PPNeueMontreal-Italic',
  semiBoldItalic: 'PPNeueMontreal-SemiBoldItalic',
} as const;

// Eyebrow / kicker labels — system mono, no custom font.
export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as string;
