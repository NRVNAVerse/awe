"use client";

import { sharedControlState } from "@oncyberio/engine/input";
import { useEffect, useRef } from "react";
import { useInteractionMode } from "@/lib/interaction-mode";
import { PointerOwner } from "@/lib/input/touch-controls";

export function JumpButton() {
  // Shared shell interaction mode (2B.4C.2) — same detection the starter used, now app-wide.
  const enabled = useInteractionMode().touch;
  // First-pointer ownership (post-M0 input hardening): the finger that pressed jump is the only one
  // that can release it, so another finger lifting elsewhere cannot cut a held jump short.
  const ownerRef = useRef<PointerOwner | null>(null);
  ownerRef.current ??= new PointerOwner();

  useEffect(() => {
    return () => {
      ownerRef.current?.reset();
      sharedControlState.custom.releaseButton("jump");
    };
  }, []);

  if (!enabled) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <button
        type="button"
        data-jump-button=""
        className="pointer-events-auto fixed flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/30 text-[11px] font-semibold uppercase tracking-[0.22em] text-white shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-md select-none"
        style={{
          touchAction: "none",
          // Safe-area aware (2B.4C.2): 1rem from the corner plus the device inset, never a hard-coded notch size.
          right: "calc(1rem + env(safe-area-inset-right, 0px))",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
        onPointerDown={(event) => {
          if (!ownerRef.current!.claim(event.pointerId)) {
            return; // already held by another pointer
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          sharedControlState.custom.pressButton("jump");
        }}
        onPointerUp={(event) => {
          if (!ownerRef.current!.release(event.pointerId)) {
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          sharedControlState.custom.releaseButton("jump");
        }}
        onPointerCancel={(event) => {
          if (!ownerRef.current!.release(event.pointerId)) {
            return;
          }
          sharedControlState.custom.releaseButton("jump");
        }}
      >
        Jump
      </button>
    </div>
  );
}
