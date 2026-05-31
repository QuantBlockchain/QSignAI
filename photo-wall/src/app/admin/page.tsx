"use client";

import { useState, useEffect, useCallback } from "react";
import ThemeToggle from "@/components/ThemeToggle";

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
        const preferred = data.defaultGroup
          ? data.groups.find((g: any) => g.groupId === data.defaultGroup)
          : null;
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
      <div className="admin-page admin-login">
        <div className="admin-login-card">
          <h1 className="admin-login-title">Admin Login</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
            className="admin-input"
          />
          {error && <p className="admin-error">{error}</p>}
          <button onClick={login} className="admin-btn-primary">Login</button>
        </div>
        <div className="admin-toggle-corner"><ThemeToggle /></div>
      </div>
    );
  }

  // Admin dashboard
  return (
    <div className="admin-page">
      <div className="admin-container">
        {/* Header */}
        <div className="admin-header">
          <h1 className="admin-title">Photo Wall Admin</h1>
          <div className="admin-header-actions">
            <ThemeToggle />
            <button
              onClick={() => { setLoggedIn(false); setToken(""); }}
              className="admin-btn-ghost"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Group selector */}
        <div className="admin-controls">
          <label className="admin-label">Group:</label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="admin-select"
          >
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>{g.name}</option>
            ))}
          </select>
          <button onClick={fetchMessages} className="admin-btn-accent">Refresh</button>
          <button onClick={clearAll} className="admin-btn-danger admin-mleft-auto">
            Clear All Messages
          </button>
        </div>

        {/* User summary */}
        {messages.length > 0 && (() => {
          const userMap = new Map<string, { name: string; count: number; firstTime: number; lastTime: number; qn: number | null }>();
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
          const users = Array.from(userMap.values()).sort((a, b) => a.firstTime - b.firstTime);
          return (
            <div className="admin-section">
              <h2 className="admin-section-title">Users ({users.length})</h2>
              <table className="admin-table">
                <thead>
                  <tr>
                    {["#", "Name", "Messages", "Quantum Sig", "First Message", "Last Message"].map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u, i) => (
                    <tr key={u.name}>
                      <td className={`admin-rank rank-${i + 1}`}>{i + 1}</td>
                      <td>{u.name}</td>
                      <td className="admin-cell-muted">{u.count}</td>
                      <td className={u.qn != null ? "admin-cell-accent" : "admin-cell-muted"}>
                        {u.qn != null ? `Q#${u.qn}` : "-"}
                      </td>
                      <td className="admin-cell-muted">{new Date(u.firstTime).toLocaleString("zh-CN")}</td>
                      <td className="admin-cell-muted">{new Date(u.lastTime).toLocaleString("zh-CN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* Messages table */}
        <div className="admin-count">{messages.length} messages</div>

        {loading ? (
          <p className="admin-loading">Loading...</p>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                {["ID", "Sender", "Text", "Type", "QSig", "Time", ""].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <tr key={m.sk}>
                  <td className="admin-cell-muted">{m.messageId}</td>
                  <td>{m.senderName}</td>
                  <td className="admin-cell-text">
                    <div className="admin-msg">
                      {m.type === "photo" && m.photoUrl && (
                        <img
                          src={m.photoUrl}
                          alt="thumb"
                          onClick={() => setPreviewImg(m.photoUrl!)}
                          className="admin-thumb"
                        />
                      )}
                      <span className="admin-msg-text">
                        {m.text || (m.type === "photo" && !m.photoUrl ? "[Photo]" : "")}
                      </span>
                    </div>
                  </td>
                  <td className="admin-cell-muted">{m.type}</td>
                  <td className={m.signatureStatus === "completed" ? "admin-cell-accent" : "admin-cell-muted"}>
                    {m.signatureStatus === "completed" ? `Q#${m.quantumNumber}` : m.signatureStatus || "-"}
                  </td>
                  <td className="admin-cell-muted">{new Date(m.timestamp).toLocaleString("zh-CN")}</td>
                  <td>
                    <button onClick={() => hideMessage(m.sk)} className="admin-btn-hide">Hide</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Image preview lightbox */}
      {previewImg && (
        <div onClick={() => setPreviewImg(null)} className="admin-lightbox">
          <img src={previewImg} alt="Preview" className="admin-lightbox-img" />
        </div>
      )}
    </div>
  );
}
