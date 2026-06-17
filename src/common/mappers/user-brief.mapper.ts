import { User } from '../../entities/user.entity';

/**
 * UserBrief — the compact user shape consumed by the Community UI for authors,
 * mentions, praised people and members (docs/community.md §3.1).
 *
 * The platform `User` has no `name`/`avatarUrl`; we derive them from
 * `fullName` and `profilePicture`.
 */
export interface UserBrief {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Map a full User entity to a UserBrief. */
export function toUserBrief(user: User): UserBrief {
  return {
    id: user.id,
    name: user.fullName,
    avatarUrl: user.profilePicture ?? null,
  };
}

/** Map a list of users, skipping null/undefined entries. */
export function toUserBriefs(users: (User | null | undefined)[]): UserBrief[] {
  return users.filter((u): u is User => !!u).map(toUserBrief);
}
