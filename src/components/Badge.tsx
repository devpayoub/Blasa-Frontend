import { cva, type VariantProps } from 'class-variance-authority';
import { Text, View } from 'react-native';

import { cn } from '@/lib/cn';

const badge = cva('items-center justify-center rounded-pill', {
  variants: {
    tone: {
      accent: 'bg-accent',
      deal: 'bg-deal',
      warning: 'bg-warning',
      neutral: 'bg-fg',
      soft: 'bg-accentSoft',
    },
    size: {
      sm: 'px-2 py-0.5',
      md: 'px-2.5 py-1',
    },
  },
  defaultVariants: { tone: 'accent', size: 'md' },
});

const badgeText = cva('font-semibold text-meta', {
  variants: {
    tone: {
      accent: 'text-onAccent',
      deal: 'text-bg',
      warning: 'text-onAccent',
      neutral: 'text-bg',
      soft: 'text-accentStrong',
    },
  },
  defaultVariants: { tone: 'accent' },
});

export interface BadgeProps extends VariantProps<typeof badge> {
  label: string;
  className?: string;
}

export function Badge({ label, tone, size, className }: BadgeProps) {
  return (
    <View className={cn(badge({ tone, size }), className)}>
      <Text className={badgeText({ tone })}>{label}</Text>
    </View>
  );
}

/** Small numeric count bubble used on the bookings tab. */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <View
      accessibilityLabel={`${count} items`}
      className={cn('h-5 min-w-5 items-center justify-center rounded-pill bg-accent px-1.5', className)}>
      <Text className="font-bold text-meta text-onAccent">{count > 99 ? '99+' : count}</Text>
    </View>
  );
}
