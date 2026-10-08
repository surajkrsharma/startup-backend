export const SEGMENT_KIND = {
  MANUAL: 'MANUAL',
  NEW: 'NEW',
  REPEAT: 'REPEAT',
  VIP: 'VIP',
  WHOLESALE: 'WHOLESALE',
  BLOCKED: 'BLOCKED',
} as const;

export type SegmentKind = keyof typeof SEGMENT_KIND;

export const SEGMENT_KIND_VALUES = Object.values(SEGMENT_KIND) as SegmentKind[];

/** Kinds the refresh job owns; a hand edit to one of these is overwritten. */
export const AUTO_SEGMENT_KINDS: SegmentKind[] = [
  SEGMENT_KIND.NEW,
  SEGMENT_KIND.REPEAT,
  SEGMENT_KIND.VIP,
  SEGMENT_KIND.WHOLESALE,
  SEGMENT_KIND.BLOCKED,
];

export const isAutoSegmentKind = (kind: string): boolean =>
  AUTO_SEGMENT_KINDS.includes(kind as SegmentKind);

export const SEGMENT_SOURCE = {
  MANUAL: 'MANUAL',
  RULE: 'RULE',
} as const;

export type SegmentSource = keyof typeof SEGMENT_SOURCE;

export const SEGMENT_SOURCE_VALUES = Object.values(SEGMENT_SOURCE) as SegmentSource[];

export const ANNOUNCEMENT_STATUS = {
  ACTIVE: 'ACTIVE',
  ARCHIVED: 'ARCHIVED',
} as const;

export type AnnouncementStatus = keyof typeof ANNOUNCEMENT_STATUS;

export const ANNOUNCEMENT_STATUS_VALUES = Object.values(
  ANNOUNCEMENT_STATUS,
) as AnnouncementStatus[];

export const BAN_REASON_MAX_LENGTH = 500;
export const VACATION_MAX_DAYS = 90;
