import Ionicons from '@expo/vector-icons/Ionicons';
import { cssInterop } from 'nativewind';

/**
 * Map NativeWind `className` color onto Ionicons' `color` prop so icons can use
 * semantic text tokens (`text-fg`, `text-accent`, …) like everything else.
 */
cssInterop(Ionicons, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true },
  },
});

export type IconName = keyof typeof Ionicons.glyphMap;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 20, className = 'text-fg' }: IconProps) {
  return <Ionicons name={name} size={size} className={className} />;
}
