"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import MessageCard from "./MessageCard";
import Lightbox from "./Lightbox";

interface Message {
  messageId: number;
  groupId: string;
  type: string;
  text: string;
  photoUrl: string | null;
  senderName: string;
  senderUsername: string;
  timestamp: number;
  createdAt: string;
  sk: string;
  signatureStatus?: string | null;
  quantumNumber?: number | null;
  publicKeyHash?: string | null;
  quantumSignature?: string | null;
  visualColor?: string | null;
  posX?: number | null;
  posY?: number | null;
}

interface CardPos { x: number; y: number }
interface PhotoWallProps {
  groupId: string;
  maxLeaderboard?: number;
}

function rng(seed: number, index: number, salt: number): number {
  const v = ((seed * 2654435761 + index * 40503 + salt * 11) ^ 0x5f3759df) >>> 0;
  return (v % 10000) / 10000;
}

const TOP_PAD = 32;
const PAD = 12;

function calcGrid(
  count: number, viewW: number, viewH: number
): { cols: number; rows: number; cardW: number; cardH: number; cellW: number; cellH: number } {
  if (count === 0 || viewW < 10 || viewH < 10)
    return { cols: 1, rows: 1, cardW: 200, cardH: 200, cellW: viewW, cellH: viewH };

  const uW = viewW - PAD * 2;
  const uH = viewH - TOP_PAD - PAD;

  // Try every column count, pick the one that fills the screen best
  // with cards capped at 260x280
  let bestCols = 1, bestW = 0, bestH = 0, bestScore = 0;
  for (let c = 1; c <= Math.min(count, 12); c++) {
    const r = Math.ceil(count / c);
    const cw = Math.floor(uW / c) - 10;
    const ch = Math.floor(uH / r) - 10;
    if (cw < 100 || ch < 70) continue;
    // Coverage: how much of the screen is filled by cards
    const cardW = Math.min(cw, 260);
    const cardH = Math.min(ch, 280);
    const coverage = (cardW * cardH * count) / (uW * uH);
    // Aspect: prefer ~4:3
    const aspect = cardW / cardH;
    const aspectScore = 1 - Math.abs(aspect - 1.2) * 0.3;
    const score = coverage * Math.max(aspectScore, 0.3);
    if (score > bestScore) { bestCols = c; bestW = cardW; bestH = cardH; bestScore = score; }
  }

  const rows = Math.ceil(count / bestCols);
  return {
    cols: bestCols,
    rows,
    cardW: bestW,
    cardH: bestH,
    cellW: (viewW - PAD * 2) / bestCols,
    cellH: (viewH - TOP_PAD - PAD) / rows,
  };
}

// Position one card within the full-screen grid
function assignPosition(
  seed: number, gridIndex: number, grid: ReturnType<typeof calcGrid>,
  viewW: number, viewH: number
): CardPos {
  const { cols, cellW, cellH, cardW, cardH } = grid;
  const col = gridIndex % cols;
  const row = Math.floor(gridIndex / cols);

  // Center of cell
  const cx = PAD + col * cellW + cellW / 2 - cardW / 2;
  const cy = TOP_PAD + row * cellH + cellH / 2 - cardH / 2;

  // Scatter: random offset up to 20% of cell padding
  const gapX = cellW - cardW;
  const gapY = cellH - cardH;
  const ox = (rng(seed, gridIndex, 1) - 0.5) * gapX * 0.7;
  const oy = (rng(seed, gridIndex, 2) - 0.5) * gapY * 0.7;

  return {
    x: Math.max(2, Math.min(cx + ox, viewW - cardW - 2)),
    y: Math.max(TOP_PAD, Math.min(cy + oy, viewH - cardH - 2)),
  };
}

export default function PhotoWall({ groupId, maxLeaderboard = 10 }: PhotoWallProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [lightboxCaption, setLightboxCaption] = useState("");
  const [topZ, setTopZ] = useState(1000);
  const [dragZMap, setDragZMap] = useState<Record<number, number>>({});
  const [positions, setPositions] = useState<Record<number, CardPos>>({});
  const [cardSize, setCardSize] = useState({ w: 260, h: 280 });
  const latestTimestamp = useRef(0);
  const initialLoaded = useRef(false);
  const hasPendingSig = useRef(false);
  const dragRef = useRef<{
    msgId: number; startX: number; startY: number; origX: number; origY: number;
  } | null>(null);

  // Full re-layout (initial load + resize)
  // DB stores percentages (0-100), rendering uses pixels
  const fullLayout = useCallback(() => {
    if (messages.length === 0) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const grid = calcGrid(messages.length, vw, vh);
    setCardSize({ w: grid.cardW, h: grid.cardH });

    const newPos: Record<number, CardPos> = {};
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      // Convert saved percentage → pixels
      if (msg.posX != null && msg.posY != null) {
        newPos[msg.messageId] = {
          x: (msg.posX / 100) * vw,
          y: (msg.posY / 100) * vh,
        };
      } else {
        newPos[msg.messageId] = assignPosition(msg.messageId, i, grid, vw, vh);
      }
    }
    setPositions(newPos);
  }, [messages]);

  useEffect(() => {
    fullLayout();
    window.addEventListener("resize", fullLayout);
    return () => window.removeEventListener("resize", fullLayout);
  }, [fullLayout]);

  // Data fetching
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${encodeURIComponent(groupId)}?limit=50`);
      if (!res.ok) return;
      const data = await res.json();
      const msgs: Message[] = data.messages.reverse();
      setMessages(msgs);
      hasPendingSig.current = msgs.some((m) => m.signatureStatus === "generating");
      if (msgs.length > 0) {
        latestTimestamp.current = Math.max(...msgs.map((m) => m.timestamp));
      }
      initialLoaded.current = true;
    } catch (err) {
      console.error("Failed to load messages:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const pollNewMessages = useCallback(async () => {
    if (!initialLoaded.current) return;
    try {
      // If any messages are still "generating", refetch all to pick up completed signatures
      if (hasPendingSig.current) {
        const res = await fetch(`/api/messages/${encodeURIComponent(groupId)}?limit=50`);
        if (!res.ok) return;
        const data = await res.json();
        const refreshed: Message[] = data.messages.reverse();
        const stillPending = refreshed.some((m: Message) => m.signatureStatus === "generating");
        hasPendingSig.current = stillPending;
        setMessages((prev) => {
          const map = new Map(refreshed.map((m: Message) => [m.messageId, m]));
          return prev.map((m) => map.get(m.messageId) || m);
        });
      }

      // Also check for new messages
      const url = latestTimestamp.current
        ? `/api/messages/${encodeURIComponent(groupId)}?after=${latestTimestamp.current}&limit=20`
        : `/api/messages/${encodeURIComponent(groupId)}?limit=50`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages.length > 0) {
        const incoming: Message[] = latestTimestamp.current ? data.messages : data.messages.reverse();
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.messageId));
          const newMsgs = incoming.filter((m: Message) => !existingIds.has(m.messageId));
          if (newMsgs.length === 0) return prev;
          for (const m of newMsgs) {
            if (m.timestamp > latestTimestamp.current) latestTimestamp.current = m.timestamp;
          }
          // New messages go to the front (newest first)
          const updated = [...newMsgs, ...prev];
          if (newMsgs.some((m: Message) => m.signatureStatus === "generating")) {
            hasPendingSig.current = true;
          }

          // Position new messages at top of screen
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const grid = calcGrid(updated.length, vw, vh);
          setCardSize({ w: grid.cardW, h: grid.cardH });

          setPositions((prevPos) => {
            const nextPos = { ...prevPos };
            for (let i = 0; i < newMsgs.length; i++) {
              const msg = newMsgs[i];
              // Top row positioning
              const col = i % grid.cols;
              const x = PAD + col * grid.cellW + grid.cellW / 2 - grid.cardW / 2
                + (rng(msg.messageId, i, 1) - 0.5) * (grid.cellW - grid.cardW) * 0.6;
              const y = TOP_PAD + (rng(msg.messageId, i, 2)) * (grid.cellH - grid.cardH) * 0.4;
              nextPos[msg.messageId] = {
                x: Math.max(2, Math.min(x, vw - grid.cardW - 2)),
                y: Math.max(TOP_PAD, y),
              };
              // Bump z to top
              setTopZ((z) => {
                const newZ = z + 1;
                setDragZMap((dz) => ({ ...dz, [msg.messageId]: newZ }));
                return newZ;
              });
            }
            return nextPos;
          });

          return updated;
        });
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [groupId]);

  useEffect(() => {
    setMessages([]);
    setLoading(true);
    latestTimestamp.current = 0;
    initialLoaded.current = false;
    setPositions({});
    setDragZMap({});
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    const timer = setInterval(pollNewMessages, 5000);
    return () => clearInterval(timer);
  }, [pollNewMessages]);

  // Delete single message (soft delete)
  const handleDelete = useCallback(async (messageId: number, sk: string) => {
    if (!sk) return;
    await fetch(`/api/messages/${encodeURIComponent(groupId)}?sk=${encodeURIComponent(sk)}`, { method: "DELETE" });
    setMessages((prev) => prev.filter((m) => m.messageId !== messageId));
    setPositions((prev) => {
      const next = { ...prev };
      delete next[messageId];
      return next;
    });
  }, [groupId]);

  // Clear all messages (soft delete)
  const handleClearAll = useCallback(async () => {
    await fetch(`/api/messages/${encodeURIComponent(groupId)}?all=true`, { method: "DELETE" });
    setMessages([]);
    setPositions({});
    latestTimestamp.current = 0;
  }, [groupId]);

  // Drag handlers
  const handlePointerDown = useCallback((e: React.PointerEvent, msgId: number) => {
    if ((e.target as HTMLElement).tagName === "IMG") return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = positions[msgId];
    if (!pos) return;
    dragRef.current = { msgId, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    setTopZ((z) => {
      const newZ = z + 1;
      setDragZMap((prev) => ({ ...prev, [msgId]: newZ }));
      return newZ;
    });
  }, [positions]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    setPositions((prev) => ({
      ...prev,
      [drag.msgId]: {
        x: drag.origX + (e.clientX - drag.startX),
        y: drag.origY + (e.clientY - drag.startY),
      },
    }));
  }, []);

  const handlePointerUp = useCallback(() => {
    if (!dragRef.current) return;
    const { msgId } = dragRef.current;
    dragRef.current = null;

    // Persist position as percentage to DB
    const pos = positions[msgId];
    const msg = messages.find((m) => m.messageId === msgId);
    if (pos && msg?.sk) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pctX = parseFloat(((pos.x / vw) * 100).toFixed(2));
      const pctY = parseFloat(((pos.y / vh) * 100).toFixed(2));
      fetch(`/api/messages/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sk: msg.sk, posX: pctX, posY: pctY }),
      }).catch(() => {}); // fire-and-forget
    }
  }, [positions, messages, groupId]);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Status bar — top right */}
      <div
        className="font-sans select-none"
        style={{ position: "absolute", top: 10, right: 12, zIndex: 15, display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap", flexWrap: "nowrap" }}
      >
        <span className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="text-white/50 text-sm tracking-wider uppercase">Live</span>
        </span>
        <span className="text-white/20">|</span>
        <span className="text-white/40 text-sm">{messages.length} notes</span>
      </div>

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-white/10 border-t-white/60 rounded-full animate-spin" />
            <span className="text-white/40 text-xl tracking-[0.3em] uppercase font-sans">Loading</span>
          </div>
        </div>
      )}

      {!loading && messages.length === 0 && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          <div className="text-7xl mb-6">📌</div>
          <p className="handwritten text-3xl text-white/50">The wall is empty...</p>
          <p className="handwritten text-xl text-white/30 mt-2">Send something in the Telegram group!</p>
        </div>
      )}

      {!loading && messages.map((msg, i) => {
        const pos = positions[msg.messageId];
        if (!pos) return null;
        const baseZ = messages.length - i;
        const z = dragZMap[msg.messageId] || baseZ;

        return (
          <div
            key={msg.messageId}
            style={{
              position: "absolute",
              left: pos.x,
              top: pos.y,
              width: cardSize.w,
              zIndex: z,
              cursor: "grab",
              touchAction: "none",
            }}
            onPointerDown={(e) => handlePointerDown(e, msg.messageId)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <MessageCard
              message={msg}
              index={i}
              cardWidth={cardSize.w}
              cardHeight={cardSize.h}
              onImageClick={(src, caption) => {
                setLightboxSrc(src);
                setLightboxCaption(caption);
              }}
            />
          </div>
        );
      })}

      {/* Leaderboard — bottom center, shows first N unique senders in order */}
      {!loading && messages.length > 0 && (() => {
        const seen = new Set<string>();
        const leaders: { name: string; visualColor?: string | null; quantumNumber?: number | null }[] = [];
        // messages[0] is newest; walk newest→oldest to get senders in order of first appearance
        for (const m of messages) {
          if (!seen.has(m.senderName)) {
            seen.add(m.senderName);
            leaders.push({ name: m.senderName, visualColor: m.visualColor, quantumNumber: m.quantumNumber });
            if (leaders.length >= maxLeaderboard) break;
          }
        }
        if (leaders.length === 0) return null;
        return (
          <div
            className="font-sans select-none"
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 15,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 16px",
              borderRadius: 12,
              background: "rgba(0, 0, 0, 0.4)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)",
              whiteSpace: "nowrap",
              maxWidth: "90vw",
              overflow: "hidden",
            }}
          >
            {leaders.map((l, i) => (
              <div
                key={l.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "3px 10px",
                  borderRadius: 8,
                  background: i === 0 ? "rgba(255, 200, 0, 0.12)" : "rgba(255,255,255,0.05)",
                  border: i === 0 ? "1px solid rgba(255, 200, 0, 0.25)" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "rgba(255,255,255,0.4)",
                  minWidth: 16,
                }}>
                  #{i + 1}
                </span>
                {l.visualColor && (
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: l.visualColor,
                    boxShadow: `0 0 4px ${l.visualColor}`,
                    flexShrink: 0,
                  }} />
                )}
                <span style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "rgba(255,255,255,0.75)",
                }}>
                  {l.name}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {lightboxSrc && (
        <Lightbox src={lightboxSrc} caption={lightboxCaption} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
