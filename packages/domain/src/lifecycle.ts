export const CAPSULE_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "published",
  "superseded",
  "archived",
] as const;

export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];

export function isPublishedStatus(status: CapsuleStatus): boolean {
  return (
    status === "published" || status === "superseded" || status === "archived"
  );
}
