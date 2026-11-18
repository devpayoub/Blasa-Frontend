import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { cn } from '@/lib/cn';
import { Icon, type IconName } from './Icon';

export interface FieldProps extends TextInputProps {
  label: string;
  error?: string;
  icon?: IconName;
  /** Larger height + centered text — used for OTP code entry. */
  code?: boolean;
  className?: string;
}

export function Field({
  label,
  error,
  icon,
  code = false,
  className,
  onFocus,
  onBlur,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View className={className}>
      <Text className="mb-1.5 font-semibold text-meta text-muted">{label}</Text>
      <View
        className={cn(
          'field-shell flex-row items-center rounded-input border bg-surface px-3.5',
          error ? 'border-deal' : focused ? 'border-accent' : 'border-line',
        )}>
        {icon ? <Icon name={icon} size={18} className="mr-2 text-faint" /> : null}
        <TextInput
          className={cn(
            'min-h-11 flex-1 py-2.5 text-fg',
            code ? 'text-center text-h tracking-[8px]' : 'text-body',
          )}
          placeholderTextColor="rgb(148 146 140)"
          accessibilityLabel={label}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...rest}
        />
      </View>
      {error ? <Text className="mt-1 text-meta text-deal">{error}</Text> : null}
    </View>
  );
}
