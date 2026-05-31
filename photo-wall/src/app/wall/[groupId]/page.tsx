import { notFound } from "next/navigation";
import { getGroup } from "@/lib/config";
import PhotoWall from "@/components/PhotoWall";
import WallChrome from "@/components/WallChrome";

interface Props {
  params: Promise<{ groupId: string }>;
}

export default async function WallPage({ params }: Props) {
  const { groupId } = await params;
  const group = getGroup(groupId);

  if (!group) {
    notFound();
  }

  return (
    <WallChrome>
      <PhotoWall groupId={groupId} maxLeaderboard={10} />
    </WallChrome>
  );
}
