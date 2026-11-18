import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { listInterestTags } from '@/services/users';
import type { InterestTag } from '@/types';
import { Chip } from './Chip';
import { PressableScale } from './PressableScale';
import { Spinner } from './Spinner';

export function useInterestTags(): { tags?: InterestTag[]; failed: boolean; retry: () => void } {
  const [tags, setTags] = useState<InterestTag[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    listInterestTags()
      .then((next) => { if (active) { setTags(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);

  return { tags, failed, retry: () => setAttempt((n) => n + 1) };
}

/** Multi-select chips over the interest catalogue. */
export function InterestPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const { tags, failed, retry } = useInterestTags();

  if (failed && !tags) {
    return (
      <PressableScale accessibilityRole="button" accessibilityLabel="Retry loading interests" onPress={retry} className="h-11 justify-center">
        <Text className="text-body text-deal">Interests could not load. Tap to try again.</Text>
      </PressableScale>
    );
  }
  if (!tags) return <Spinner className="self-start" />;

  return (
    <View className="flex-row flex-wrap gap-2">
      {tags.map((tag) => {
        const on = selected.includes(tag.slug);
        return (
          <PressableScale
            key={tag.slug}
            accessibilityRole="checkbox"
            accessibilityLabel={tag.labels.en}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={() => onChange(on ? selected.filter((slug) => slug !== tag.slug) : [...selected, tag.slug])}>
            <Chip label={tag.labels.en} selected={on} size="sm" />
          </PressableScale>
        );
      })}
    </View>
  );
}
