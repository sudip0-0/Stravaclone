import type { UpdateUserRequest, User } from '@trail/contracts';

export function profilePatch(
  original: User,
  draft: Pick<User, 'display_name' | 'units' | 'default_sport'>,
): UpdateUserRequest | null {
  const patch: UpdateUserRequest = {};
  if (draft.display_name.trim() !== original.display_name)
    patch.display_name = draft.display_name.trim();
  if (draft.units !== original.units) patch.units = draft.units;
  if (draft.default_sport !== original.default_sport)
    patch.default_sport = draft.default_sport;
  return Object.keys(patch).length ? patch : null;
}
