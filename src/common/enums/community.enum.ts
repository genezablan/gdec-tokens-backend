/**
 * Canonical Community / Communities enums.
 * Mirrors `docs/community.md` §4 — the backend owns these lists.
 */

export enum PostType {
  DISCUSSION = 'discussion',
  QUESTION = 'question',
  PRAISE = 'praise',
  POLL = 'poll',
}

export enum PraiseBadge {
  KUDOS = 'kudos',
  THANK_YOU = 'thank-you',
  GREAT_WORK = 'great-work',
  TEAM_PLAYER = 'team-player',
  ABOVE_BEYOND = 'above-beyond',
  INNOVATOR = 'innovator',
}

export enum AttachmentType {
  IMAGE = 'image',
  FILE = 'file',
}

export enum ResourceType {
  SHAREPOINT = 'sharepoint',
  ONENOTE = 'onenote',
  PLANNER = 'planner',
  LINK = 'link',
}

export enum CommunityPrivacy {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

/**
 * Per-community role. `null` (not a row in community_members) means non-member —
 * represented by the absence of a membership record, not a stored enum value.
 */
export enum CommunityRole {
  ADMIN = 'admin',
  MEMBER = 'member',
}
