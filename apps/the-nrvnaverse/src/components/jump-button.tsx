"use client";

import { sharedControlState } from "@oncyberio/engine/input";
import { useEffect } from "react";
import { useInteractionMode } from "@/lib/interaction-mode";

export function JumpButton() {
  // Shared shell interaction mode (2B.4C.2) — same detection the starter used, now app-wide.
  const enabled = useInteractionMode().touch;

  useEffect(() => {
    return () => {
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
        className="pointer-events-auto fixed flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/30 text-[11px] font-semibold uppercase tracking-[0.22em] text-white shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-md select-none"
        style={{
          touchAction: "none",
          // Safe-area aware (2B.4C.2): 1rem from the corner plus the device inset, never a hard-coded notch size.
          right: "calc(1rem + env(safe-area-inset-right, 0px))",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
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
