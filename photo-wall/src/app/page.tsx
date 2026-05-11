import { redirect } from "next/navigation";
import { getGroups } from "@/lib/config";

export default function Home() {
  const groups = getGroups();
  if (groups.length > 0) {
    redirect(`/wall/${groups[0].groupId}`);
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center text-[var(--text-muted)]">
        <h1 className="text-2xl font-bold mb-4">Photo Wall</h1>
        <p>No groups configured.</p>
      </div>
    </main>
  );
}
