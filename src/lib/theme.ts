import { useColorScheme } from 'nativewind';

/**
 * The single source of raw color values — mirrors the CSS variables in
 * `global.css`. Components style with `className`; only the rare prop that
 * needs an actual color string (placeholderTextColor, StatusBar, Reanimated
 * color interpolation) reads from here.
 *
 * Palette law (60/30/10): cream #F0E7D5 carries the canvas, navy #13294B
 * carries structure and text, orange #FF6A1F is the only accent — CTAs,
 * active states, fares. `accentStrong` is a deeper shade of the same hue
 * for small text on `accentSoft`; it is not a second accent.
 */
type ColorKey =
  | 'bg'
  | 'surface'
  | 'fg'
  | 'muted'
  | 'faint'
  | 'line'
  | 'accent'
  | 'accentStrong'
  | 'accentSoft'
  | 'onAccent'
  | 'deal'
  | 'warning'
  | 'cream'
  | 'navy';

const LIGHT: Record<ColorKey, string> = {
  bg: 'rgb(240 231 213)',
  surface: 'rgb(250 246 236)',
  fg: 'rgb(19 41 75)',
  muted: 'rgb(95 105 125)',
  faint: 'rgb(148 146 140)',
  line: 'rgb(224 216 199)',
  accent: 'rgb(255 106 31)',
  accentStrong: 'rgb(209 77 0)',
  accentSoft: 'rgb(255 227 209)',
  onAccent: 'rgb(19 41 75)',
  deal: 'rgb(191 54 30)',
  warning: 'rgb(173 116 0)',
  cream: 'rgb(240 231 213)',
  navy: 'rgb(19 41 75)',
};

const DARK: Record<ColorKey, string> = {
  bg: 'rgb(9 22 42)',
  surface: 'rgb(19 41 75)',
  fg: 'rgb(240 231 213)',
  muted: 'rgb(164 164 158)',
  faint: 'rgb(118 122 128)',
  line: 'rgb(40 54 74)',
  accent: 'rgb(255 106 31)',
  accentStrong: 'rgb(255 138 77)',
  accentSoft: 'rgb(61 44 32)',
  onAccent: 'rgb(19 41 75)',
  deal: 'rgb(232 101 74)',
  warning: 'rgb(240 168 64)',
  cream: 'rgb(240 231 213)',
  navy: 'rgb(19 41 75)',
};

export type ThemeColors = Record<ColorKey, string>;

export const themeColors = { light: LIGHT, dark: DARK };

/** Resolved color values for the active scheme. */
export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? DARK : LIGHT;
}

/**
 * The one elevation level of the app — cards lift off the canvas with this,
 * never with stacked shadow sizes. Uses the `boxShadow` style string
 * (RN 0.76+), tinted navy so it stays warm on the cream canvas.
 */
export const CARD_SHADOW = {
  boxShadow: '0 1px 2px rgba(19, 41, 75, 0.05), 0 6px 16px rgba(19, 41, 75, 0.07)',
} as const;

/** Neutral blurhash used as the image placeholder. */
export const PLACEHOLDER_BLURHASH = 'L6Pj0^jE.AyE_3t7t7R**0o#DgR4';
