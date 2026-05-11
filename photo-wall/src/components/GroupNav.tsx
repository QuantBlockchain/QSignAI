"use client";

import Link from "next/link";

interface GroupNavProps {
  groups: { groupId: string; name: string }[];
  currentGroupId: string;
}

export default function GroupNav({ groups, currentGroupId }: GroupNavProps) {
  if (groups.length <= 1) return null;

  return (
    <nav className="flex justify-center gap-3 flex-wrap">
      {groups.map((g) => (
        <Link
          key={g.groupId}
          href={`/wall/${g.groupId}`}
          className={`relative inline-block px-6 py-2.5 rounded-full text-sm font-medium tracking-wide transition-all duration-300 ${
            g.groupId === currentGroupId
              ? "text-white"
              : "text-[var(--text-muted)] hover:text-white border border-[var(--text-muted)]/20 hover:border-[var(--accent)]/50"
          }`}
          style={
            g.groupId === currentGroupId
              ? {
                  background: "linear-gradient(135deg, var(--accent), var(--accent2))",
                  boxShadow: "0 4px 20px rgba(0, 212, 255, 0.3)",
                }
              : {}
          }
        >
          {g.name}
        </Link>
      ))}
    </nav>
  );
}
