import { ReactNode } from "react";

export default function WallChrome({ children }: { children: ReactNode }) {
  return (
    <div
      className="sci-fi-bg"
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", overflow: "hidden" }}
    >
      <div className="sci-fi-nebula-1" />
      <div className="sci-fi-nebula-2" />
      <div className="sci-fi-grid" />

      {/* QSignAI text logo — top center */}
      <div className="qsignai-logo">
        <span className="qsignai-q">Q</span>
        <span className="qsignai-rest">SignAI</span>
      </div>

      {children}
    </div>
  );
}
