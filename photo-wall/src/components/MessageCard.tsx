"use client";

import { useMemo } from "react";

interface Message {
  messageId: number;
  type: string;
  text: string;
  photoUrl: string | null;
  senderName: string;
  timestamp: number;
  signatureStatus?: string | null;
  quantumNumber?: number | null;
  publicKeyHash?: string | null;
  quantumSignature?: string | null;
  visualColor?: string | null;
}

interface Props {
  message: Message;
  index: number;
  cardWidth: number;
  cardHeight: number;
  onImageClick: (src: string, caption: string) => void;
}

const NOTE_COLORS = [
  "note-sunflower", "note-peach", "note-salmon", "note-coral",
  "note-rose", "note-tangerine", "note-sky", "note-arctic",
  "note-lavender", "note-lilac", "note-mint", "note-spring",
  "note-lime", "note-bubblegum", "note-electric", "note-aurora",
];

const PIN_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f1c40f",
  "#9b59b6", "#e67e22", "#1abc9c", "#e91e63",
  "#00bcd4", "#ff5722", "#4caf50", "#ff9800",
];

type DecoType = 0 | 1 | 2 | 3 | 4;

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = Date.now();
  const diffMin = Math.floor((now - timestamp) / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

// Calculate font sizes based on card dimensions
function getFontSizes(cardW: number, cardH: number, textLen: number, isPhoto: boolean) {
  // Base scale from card's smaller dimension
  const base = Math.min(cardW, cardH);

  if (isPhoto) {
    // Photo cards: smaller text below image
    const caption = Math.max(10, Math.min(base * 0.07, 16));
    const meta = Math.max(8, caption * 0.75);
    return { text: caption, meta };
  }

  // Text-only cards: fill the card with text
  // Longer text → smaller font to fit
  let textSize: number;
  if (textLen <= 5) {
    textSize = base * 0.2; // Very short: big text
  } else if (textLen <= 20) {
    textSize = base * 0.13;
  } else if (textLen <= 50) {
    textSize = base * 0.09;
  } else {
    textSize = base * 0.065;
  }
  textSize = Math.max(12, Math.min(textSize, 48));
  const meta = Math.max(8, Math.min(base * 0.055, 16));

  return { text: textSize, meta };
}

function QuantumBadge({ message, fontSize }: { message: Message; fontSize: number }) {
  const isGenerating = message.signatureStatus === "generating";
  const isCompleted = message.signatureStatus === "completed" && message.quantumSignature;

  if (!message.signatureStatus) return null;

  const size = Math.max(fontSize * 1.15, 11);
  const color = message.visualColor || "#6366f1";

  if (isGenerating) {
    return (
      <div className="q-badge" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        background: "rgba(100, 100, 255, 0.15)",
        border: "1px solid rgba(100, 100, 255, 0.3)",
        fontSize: size,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontWeight: 600,
        color: "rgba(60, 60, 160, 0.85)",
        letterSpacing: "0.05em",
      }}>
        <span style={{
          display: "inline-block",
          width: 9, height: 9,
          borderRadius: "50%",
          background: "rgba(100, 100, 255, 0.7)",
          animation: "breathingDot 1.5s ease-in-out infinite",
          flexShrink: 0,
        }} />
        <span>QSig generating...</span>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="q-badge-wrap" style={{ position: "relative", display: "inline-block" }}>
        <div
          className="q-badge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 8,
            background: "rgba(0, 0, 0, 0.08)",
            border: "1px solid rgba(0, 0, 0, 0.12)",
            fontSize: size,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontWeight: 600,
            color: "rgba(0, 0, 0, 0.7)",
            letterSpacing: "0.05em",
            lineHeight: 1.3,
            cursor: "default",
          }}
        >
          <span style={{
            display: "inline-block",
            width: 10, height: 10,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
            boxShadow: `0 0 8px ${color}, 0 0 3px ${color}`,
          }} />
          <span style={{ fontWeight: 800 }}>Q#{message.quantumNumber}</span>
          <span style={{ opacity: 0.25 }}>|</span>
          <span>{message.publicKeyHash}</span>
        </div>
        {/* Hover tooltip */}
        <div className="q-tooltip">
          <div>Quantum #{message.quantumNumber}</div>
          <div>Key: {message.publicKeyHash}</div>
          <div>Sig: {message.quantumSignature}</div>
          <div>Device: Amazon Braket SV1</div>
          <div>Algo: ToyLWE-Braket-SV1</div>
        </div>
      </div>
    );
  }

  return null;
}

// Hash function to spread sequential messageIds across full range
function hashId(id: number): number {
  let h = id ^ 0xdeadbeef;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export default function MessageCard({ message, index, cardWidth, cardHeight, onImageClick }: Props) {
  const style = useMemo(() => {
    const h = hashId(message.messageId);
    const rotation = ((h % 25) - 12);
    const colorIdx = (h >>> 4) % NOTE_COLORS.length;
    const pinColorIdx = (h >>> 8) % PIN_COLORS.length;
    const decoType = ((h >>> 12) % 5) as DecoType;
    const delay = Math.min(index * 60, 600);
    const tapeRot = ((h >>> 16) % 15) - 7;
    return { rotation, noteColor: NOTE_COLORS[colorIdx], pinColor: PIN_COLORS[pinColorIdx], decoType, delay, tapeRot };
  }, [message.messageId, index]);

  const isPhoto = message.type === "photo" && message.photoUrl;
  const fonts = useMemo(
    () => getFontSizes(cardWidth, cardHeight, (message.text || "").length, !!isPhoto),
    [cardWidth, cardHeight, message.text, isPhoto]
  );

  const renderDecoration = () => {
    switch (style.decoType) {
      case 0:
        return <div className="push-pin" style={{ background: style.pinColor }} />;
      case 4:
        return <div className="push-pin" style={{ background: style.pinColor, left: `${30 + (message.messageId % 40)}%` }} />;
      case 1:
        return <div className="tape-strip tape-top" style={{ "--tape-rot": `${style.tapeRot}deg` } as React.CSSProperties} />;
      case 2:
        return <div className="tape-strip tape-corner tape-left" style={{ "--tape-rot": `${30 + style.tapeRot}deg` } as React.CSSProperties} />;
      case 3:
        return <div className="tape-strip tape-corner tape-right" style={{ "--tape-rot": `${-30 + style.tapeRot}deg` } as React.CSSProperties} />;
    }
  };

  // Photo cards: reserve enough space for quantum sig + caption + username
  const metaAreaH = Math.max(65, cardHeight * 0.3);
  const imgH = cardHeight - metaAreaH;

  return (
    <div
      className={`animate-drop ${isPhoto ? "sticky-note sticky-photo" : "sticky-note"} ${style.noteColor}`}
      style={{
        "--rot": `${style.rotation}deg`,
        "--delay": `${style.delay}ms`,
        height: `${cardHeight}px`,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      } as React.CSSProperties}
    >
      {renderDecoration()}

      {isPhoto ? (
        <>
          <div
            style={{ height: imgH, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.05)" }}
            className="cursor-pointer"
            onClick={() => onImageClick(message.photoUrl!, message.text || "")}
          >
            <img
              src={message.photoUrl!}
              alt="Photo"
              loading="lazy"
              className="hover:brightness-105 transition-all"
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
            />
          </div>
          <div className="note-content" style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 2 }}>
            {message.text && (
              <p className="handwritten text-[var(--text)] break-words" style={{ fontSize: fonts.text, lineHeight: 1.3 }}>
                {message.text}
              </p>
            )}
            <QuantumBadge message={message} fontSize={fonts.meta * 0.75} />
            <div className="flex justify-between items-end">
              <span className="handwritten font-bold text-[var(--text)]/70" style={{ fontSize: fonts.meta }}>
                — {message.senderName}
              </span>
              <span className="handwritten text-[var(--text)]/40" style={{ fontSize: fonts.meta * 0.85 }}>
                {formatTime(message.timestamp)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 4 }}>
          <p className="handwritten text-[var(--text)] break-words text-center" style={{ fontSize: fonts.text, lineHeight: 1.35 }}>
            {message.text}
          </p>
          <QuantumBadge message={message} fontSize={fonts.meta * 0.8} />
          <div className="flex justify-between items-end">
            <span className="handwritten font-bold text-[var(--text)]/60" style={{ fontSize: fonts.meta }}>
              — {message.senderName}
            </span>
            <span className="handwritten text-[var(--text)]/35" style={{ fontSize: fonts.meta * 0.85 }}>
              {formatTime(message.timestamp)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
