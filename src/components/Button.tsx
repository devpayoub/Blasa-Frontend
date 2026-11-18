import { cva, type VariantProps } from 'class-variance-authority';
import { ActivityIndicator, Text, View } from 'react-native';

import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';
import { PressableScale, type PressableScaleProps } from './PressableScale';

const button = cva(
  'flex-row items-center justify-center gap-2 rounded-pill',
  {
    variants: {
      variant: {
        primary: 'bg-accent',
        secondary: 'bg-fg/8',
        soft: 'bg-accentSoft',
        ghost: 'bg-transparent',
        danger: 'bg-deal/10',
      },
      size: {
        sm: 'h-9 px-4',
        md: 'h-12 px-5',
        lg: 'h-14 px-6',
      },
      block: { true: 'w-full', false: '' },
      disabled: { true: 'opacity-40', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false, disabled: false },
  },
);

const label = cva('font-semibold', {
  variants: {
    variant: {
      // Navy label on orange — cream/white on #FF6A1F fails contrast.
      primary: 'text-onAccent',
      secondary: 'text-fg',
      soft: 'text-accentStrong',
      ghost: 'text-accentStrong',
      danger: 'text-deal',
    },
    size: { sm: 'text-body', md: 'text-title', lg: 'text-title' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export interface ButtonProps
  extends Omit<PressableScaleProps, 'children' | 'disabled'>,
    VariantProps<typeof button> {
  title: string;
  /** Ionicons name rendered before the title. */
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
}

export function Button({
  title,
  icon,
  loading,
  variant,
  size,
  block,
  disabled,
  className,
  accessibilityState,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const labelClass = label({ variant, size });

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ ...accessibilityState, disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      className={cn(button({ variant, size, block, disabled: isDisabled }), className)}
      {...rest}>
      {loading ? (
        <ActivityIndicator
          size="small"
          className={variant === 'primary' || !variant ? 'text-onAccent' : 'text-fg'}
        />
      ) : (
        <View className="flex-row items-center gap-2">
          {icon ? <Icon name={icon} size={18} className={labelClass} /> : null}
          <Text className={labelClass}>{title}</Text>
        </View>
      )}
    </PressableScale>
  );
}
