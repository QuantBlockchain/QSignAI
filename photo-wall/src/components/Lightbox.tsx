"use client";

import { useEffect, useState } from "react";

interface LightboxProps {
  src: string;
  caption: string;
  onClose: () => void;
}

export default function Lightbox({ src, caption, onClose }: LightboxProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(8px)",
          transition: "opacity 0.3s",
          opacity: visible ? 1 : 0,
        }}
      />

      {/* Content */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: "92vw",
          maxHeight: "92vh",
          transition: "all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
          opacity: visible ? 1 : 0,
          transform: visible ? "scale(1)" : "scale(0.8)",
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: -44,
            right: 0,
            color: "rgba(255,255,255,0.6)",
            fontSize: 36,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 8px",
            lineHeight: 1,
          }}
        >
          &times;
        </button>

        {/* Image */}
        <img
          src={src}
          alt="Preview"
          style={{
            maxWidth: "92vw",
            maxHeight: "88vh",
            objectFit: "contain",
            borderRadius: 12,
            boxShadow: "0 20px 80px rgba(0,0,0,0.7)",
            display: "block",
          }}
        />

        {/* Caption */}
        {caption && (
          <p
            className="handwritten"
            style={{
              textAlign: "center",
              padding: "12px 0",
              color: "rgba(255,255,255,0.8)",
              fontSize: 22,
            }}
          >
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}
