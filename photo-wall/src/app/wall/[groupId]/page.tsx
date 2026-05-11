import { notFound } from "next/navigation";
import { getGroup, getGroups } from "@/lib/config";
import PhotoWall from "@/components/PhotoWall";
import GroupNav from "@/components/GroupNav";

interface Props {
  params: Promise<{ groupId: string }>;
}

export default async function WallPage({ params }: Props) {
  const { groupId } = await params;
  const group = getGroup(groupId);

  if (!group) {
    notFound();
  }

  const allGroups = getGroups().map((g) => ({
    groupId: g.groupId,
    name: g.name,
  }));

  return (
    <div
      className="sci-fi-bg"
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", overflow: "hidden" }}
    >
      {/* Background layers */}
      <div className="sci-fi-nebula-1" />
      <div className="sci-fi-nebula-2" />
      <div className="sci-fi-grid" />

      {/* Logo — top center, blended into background */}
      <div style={{
        position: "absolute",
        top: -20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 5,
        opacity: 0.9,
        pointerEvents: "none",
      }}>
        <img
          src="/logo.png"
          alt="Quantum x AI x Web3"
          style={{
            width: "42rem",
            height: "auto",
            display: "block",
          }}
        />
      </div>


      {/* Photo wall — full viewport */}
      <PhotoWall groupId={groupId} maxLeaderboard={10} />
    </div>
  );
}
