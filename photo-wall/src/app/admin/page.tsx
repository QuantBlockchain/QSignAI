"use client";

import { useState, useEffect, useCallback } from "react";

interface Message {
  messageId: number;
  text: string;
  type: string;
  photoUrl?: string | null;
  senderName: string;
  timestamp: number;
  sk: string;
  signatureStatus?: string | null;
  quantumNumber?: number | null;
}

export default function AdminPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<{ groupId: string; name: string }[]>([]);
  const [selectedGroup, setSelectedGroup] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setError("");
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      const data = await res.json();
      setToken(data.token);
      setLoggedIn(true);
    } else {
      setError("Wrong password");
    }
  };

  const fetchGroups = useCallback(async () => {
    const res = await fetch("/api/admin", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setGroups(data.groups);
      if (data.groups.length > 0 && !selectedGroup) {
        const preferred = data.groups.find((g: any) => g.groupId === "quantum-ai-web3");
        setSelectedGroup(preferred ? preferred.groupId : data.groups[0].groupId);
      }
    }
  }, [token, selectedGroup]);

  const fetchMessages = useCallback(async () => {
    if (!selectedGroup) return;
    setLoading(true);
    const res = await fetch(`/api/messages/${selectedGroup}?limit=100`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages);
    }
    setLoading(false);
  }, [selectedGroup]);

  useEffect(() => {
    if (loggedIn) fetchGroups();
  }, [loggedIn, fetchGroups]);

  useEffect(() => {
    if (loggedIn && selectedGroup) fetchMessages();
  }, [loggedIn, selectedGroup, fetchMessages]);

  const hideMessage = async (sk: string) => {
    await fetch(`/api/admin?action=hide&groupId=${selectedGroup}&sk=${encodeURIComponent(sk)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    setMessages((prev) => prev.filter((m) => m.sk !== sk));
  };

  const clearAll = async () => {
    if (!confirm(`Clear ALL messages in "${selectedGroup}"?`)) return;
    const res = await fetch(`/api/admin?action=clear&groupId=${selectedGroup}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      alert(`Cleared ${data.deleted} messages`);
      setMessages([]);
    }
  };

  // Login screen
  if (!loggedIn) {
    return (
      <div style={{
        minHeight: "100vh", background: "#0a0a1a", display: "flex",
        alignItems: "center", justifyContent: "center", fontFamily: "sans-serif",
      }}>
        <div style={{
          background: "#12122a", padding: 40, borderRadius: 16,
          border: "1px solid rgba(0,200,255,0.15)", width: 360,
        }}>
          <h1 style={{ color: "#00d4ff", fontSize: 24, marginBottom: 24, textAlign: "center" }}>
            Admin Login
          </h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            style={{
              width: "100%", padding: "12px 16px", borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
              color: "#fff", fontSize: 16, outline: "none", marginBottom: 16,
              boxSizing: "border-box",
            }}
          />
          {error && <p style={{ color: "#ff6b6b", fontSize: 14, marginBottom: 12 }}>{error}</p>}
          <button
            onClick={login}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 8,
              background: "linear-gradient(135deg, #00d4ff, #0088cc)", border: "none",
              color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer",
            }}
          >
            Login
          </button>
        </div>
      </div>
    );
  }

  // Admin dashboard
  return (
    <div style={{
      minHeight: "100vh", background: "#0a0a1a", color: "#e0e0ff",
      fontFamily: "sans-serif", padding: 24,
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ color: "#00d4ff", fontSize: 24, margin: 0 }}>Photo Wall Admin</h1>
          <button
            onClick={() => { setLoggedIn(false); setToken(""); }}
            style={{
              background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)",
              color: "#aaa", borderRadius: 6, padding: "6px 16px", cursor: "pointer", fontSize: 13,
            }}
          >
            Logout
          </button>
        </div>

        {/* Group selector */}
        <div style={{ display: "flex", gap: 12, marginBottom: 24, alignItems: "center" }}>
          <label style={{ color: "#8a8aaa", fontSize: 14 }}>Group:</label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            style={{
              background: "#1a1a3a", border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff", borderRadius: 6, padding: "8px 12px", fontSize: 14,
            }}
          >
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>{g.name}</option>
            ))}
          </select>
          <button
            onClick={fetchMessages}
            style={{
              background: "rgba(0,200,255,0.15)", border: "1px solid rgba(0,200,255,0.3)",
              color: "#00d4ff", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13,
            }}
          >
            Refresh
          </button>
          <button
            onClick={clearAll}
            style={{
              background: "rgba(220,40,40,0.2)", border: "1px solid rgba(220,40,40,0.4)",
              color: "#ff6b6b", borderRadius: 6, padding: "8px 16px", cursor: "pointer", fontSize: 13,
              marginLeft: "auto",
            }}
          >
            Clear All Messages
          </button>
        </div>

        {/* User summary */}
        {messages.length > 0 && (() => {
          const userMap = new Map<string, { name: string; count: number; firstTime: number; lastTime: number; qn: number | null }>();
          // messages are newest-first from API, iterate to build stats
          for (const m of messages) {
            const existing = userMap.get(m.senderName);
            if (existing) {
              existing.count++;
              if (m.timestamp < existing.firstTime) existing.firstTime = m.timestamp;
              if (m.timestamp > existing.lastTime) existing.lastTime = m.timestamp;
            } else {
              userMap.set(m.senderName, {
                name: m.senderName,
                count: 1,
                firstTime: m.timestamp,
                lastTime: m.timestamp,
                qn: m.quantumNumber ?? null,
              });
            }
          }
          // Sort by first message time ascending
          const users = Array.from(userMap.values()).sort((a, b) => a.firstTime - b.firstTime);
          return (
            <div style={{ marginBottom: 32 }}>
              <h2 style={{ color: "#00d4ff", fontSize: 16, marginBottom: 12 }}>
                Users ({users.length})
              </h2>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                    {["#", "Name", "Messages", "Quantum Sig", "First Message", "Last Message"].map((h) => (
                      <th key={h} style={{ padding: "8px", textAlign: "left", color: "#8a8aaa", fontSize: 12, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "8px", fontSize: 13, color: i === 0 ? "#ffd700" : i === 1 ? "#c0c0c0" : i === 2 ? "#cd7f32" : "#666" , fontWeight: 700 }}>
                        {i + 1}
                      </td>
                      <td style={{ padding: "8px", fontSize: 13 }}>{u.name}</td>
                      <td style={{ padding: "8px", fontSize: 13, color: "#8a8aaa" }}>{u.count}</td>
                      <td style={{ padding: "8px", fontSize: 12, color: u.qn != null ? "#00d4ff" : "#666" }}>
                        {u.qn != null ? `Q#${u.qn}` : "-"}
                      </td>
                      <td style={{ padding: "8px", fontSize: 12, color: "#666" }}>
                        {new Date(u.firstTime).toLocaleString("zh-CN")}
                      </td>
                      <td style={{ padding: "8px", fontSize: 12, color: "#666" }}>
                        {new Date(u.lastTime).toLocaleString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Messages table */}
        <div style={{ color: "#8a8aaa", fontSize: 13, marginBottom: 8 }}>
          {messages.length} messages
        </div>

        {loading ? (
          <p style={{ color: "#666", textAlign: "center", padding: 40 }}>Loading...</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                {["ID", "Sender", "Text", "Type", "QSig", "Time", ""].map((h) => (
                  <th key={h} style={{ padding: "10px 8px", textAlign: "left", color: "#8a8aaa", fontSize: 12, fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.sk} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "8px", fontSize: 13, color: "#666" }}>{m.messageId}</td>
                  <td style={{ padding: "8px", fontSize: 13 }}>{m.senderName}</td>
                  <td style={{ padding: "8px", fontSize: 13, maxWidth: 300 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {m.type === "photo" && m.photoUrl && (
                        <img
                          src={m.photoUrl}
                          alt="thumb"
                          onClick={() => setPreviewImg(m.photoUrl!)}
                          style={{
                            width: 48, height: 48, objectFit: "cover", borderRadius: 4,
                            cursor: "pointer", flexShrink: 0, border: "1px solid rgba(255,255,255,0.1)",
                          }}
                        />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.text || (m.type === "photo" && !m.photoUrl ? "[Photo]" : "")}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "8px", fontSize: 12, color: "#666" }}>{m.type}</td>
                  <td style={{ padding: "8px", fontSize: 12, color: m.signatureStatus === "completed" ? "#00d4ff" : "#666" }}>
                    {m.signatureStatus === "completed" ? `Q#${m.quantumNumber}` : m.signatureStatus || "-"}
                  </td>
                  <td style={{ padding: "8px", fontSize: 12, color: "#666" }}>
                    {new Date(m.timestamp).toLocaleString("zh-CN")}
                  </td>
                  <td style={{ padding: "8px" }}>
                    <button
                      onClick={() => hideMessage(m.sk)}
                      style={{
                        background: "rgba(220,40,40,0.15)", border: "1px solid rgba(220,40,40,0.3)",
                        color: "#ff6b6b", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 11,
                      }}
                    >
                      Hide
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Image preview lightbox */}
      {previewImg && (
        <div
          onClick={() => setPreviewImg(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.9)", backdropFilter: "blur(8px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <img
            src={previewImg}
            alt="Preview"
            style={{ maxWidth: "90vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }}
          />
        </div>
      )}
    </div>
  );
}
