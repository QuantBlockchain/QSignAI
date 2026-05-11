export interface GroupConfig {
  groupId: string;
  chatId: string;
  name: string;
  secretName: string;
  botUsername?: string; // e.g. "my_photo_wall_bot" — only messages mentioning @bot are shown
}

let cachedGroups: GroupConfig[] | null = null;

export function getGroups(): GroupConfig[] {
  if (cachedGroups) return cachedGroups;
  try {
    cachedGroups = JSON.parse(process.env.GROUP_CONFIG || "[]");
  } catch {
    cachedGroups = [];
  }
  return cachedGroups!;
}

export function getGroup(groupId: string): GroupConfig | undefined {
  return getGroups().find((g) => g.groupId === groupId);
}

export function validateGroupId(groupId: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(groupId);
}
