"use client";

import { sharedControlState } from "@oncyberio/engine/input";
import { useEffect, useState } from "react";

function isTouchScreen(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches ||
    "ontouchstart" in window
  );
}

export function JumpButton() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const update = () => {
      setEnabled(isTouchScreen());
    };

    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      sharedControlState.custom.releaseButton("jump");
    };
  }, []);

  if (!enabled) {
    return null;
  }

  const releaseJump = () => {
    sharedControlState.custom.releaseButton("jump");
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <button
        type="button"
        className="pointer-events-auto fixed bottom-4 right-4 flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/30 text-[11px] font-semibold uppercase tracking-[0.22em] text-white shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-md select-none"
        style={{ touchAction: "none" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          sharedControlState.custom.pressButton("jump");
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          releaseJump();
        }}
        onPointerCancel={releaseJump}
        onPointerLeave={releaseJump}
      >
        Jump
      </button>
    </div>
  );
}
