import { cva, type VariantProps } from 'class-variance-authority';
import { Text, View } from 'react-native';

import { cn } from '@/lib/cn';

const chip = cva('items-center justify-center rounded-pill border', {
  variants: {
    selected: {
      true: 'border-accent bg-accentSoft',
      false: 'border-line bg-surface',
    },
    size: {
      sm: 'px-2.5 py-1',
      md: 'px-3.5 py-2',
    },
  },
  defaultVariants: { selected: false, size: 'md' },
});

const chipText = cva('font-semibold text-body', {
  variants: {
    selected: {
      // Orange on accentSoft fails contrast — the border carries the accent,
      // the label stays navy.
      true: 'text-fg',
      false: 'text-muted',
    },
  },
  defaultVariants: { selected: false },
});

export interface ChipProps extends VariantProps<typeof chip> {
  label: string;
  className?: string;
}

export function Chip({ label, selected, size, className }: ChipProps) {
  return (
    <View className={cn(chip({ selected, size }), className)}>
      <Text className={chipText({ selected })}>{label}</Text>
    </View>
  );
}
