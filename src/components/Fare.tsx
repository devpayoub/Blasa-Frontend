import { Text, View } from 'react-native';

import { cn } from '@/lib/cn';
import { formatFareOrFree, formatTnd } from '@/lib/money';

export interface FareProps {
  amount: string | number | null | undefined;
  /** Render "Free" instead of "0.000 TND". */
  freeAtZero?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** `accent` spends the orange — use it where the fare is the money spot. */
  tone?: 'fg' | 'accent';
  className?: string;
}

const sizeMap = {
  sm: 'text-price',
  md: 'text-title',
  lg: 'text-h',
} as const;

/** Fare display in TND (backend decimal strings, e.g. "12.500"). */
export function Fare({ amount, freeAtZero = false, size = 'sm', tone = 'fg', className }: FareProps) {
  return (
    <View
      accessibilityLabel={formatTnd(amount)}
      className={cn('flex-row items-baseline', className)}>
      <Text
        className={cn(
          'font-bold tabular-nums',
          tone === 'accent' ? 'text-accent' : 'text-fg',
          sizeMap[size],
        )}>
        {freeAtZero ? formatFareOrFree(amount) : formatTnd(amount)}
      </Text>
    </View>
  );
}
