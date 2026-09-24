"use client";

import { sharedControlState } from "@oncyberio/engine/input";
import { useEffect, useRef, useState } from "react";
import { useInteractionMode } from "@/lib/interaction-mode";
import { JoystickSurface, joystickGeometry } from "@/lib/input/touch-controls";

type JoystickPosition = {
  x: number;
  y: number;
};

type JoystickMetrics = {
  stickSize: number;
  thumbSize: number;
  outerInset: number;
  innerInset: number;
  edgeOffset: number;
};

function getJoystickMetrics(): JoystickMetrics {
  if (typeof window === "undefined") {
    return {
      stickSize: 104,
      thumbSize: 38,
      outerInset: 9,
      innerInset: 18,
      edgeOffset: 14,
    };
  }

  if (window.innerWidth <= 390) {
    return {
      stickSize: 88,
      thumbSize: 32,
      outerInset: 7,
      innerInset: 14,
      edgeOffset: 12,
    };
  }

  if (window.innerWidth <= 430) {
    return {
      stickSize: 96,
      thumbSize: 36,
      outerInset: 8,
      innerInset: 16,
      edgeOffset: 12,
    };
  }

  return {
    stickSize: 112,
    thumbSize: 40,
    outerInset: 9,
    innerInset: 18,
    edgeOffset: 14,
  };
}

export function TouchJoystick() {
  // Shared shell interaction mode (2B.4C.2) — same detection the starter used, now app-wide.
  const enabled = useInteractionMode().touch;
  const [metrics, setMetrics] = useState<JoystickMetrics>(getJoystickMetrics);
  // Thumb offset as a fraction of the stick radius (screen space), as `VirtualJoystick` reports it.
  const [thumb, setThumb] = useState<JoystickPosition>({ x: 0, y: 0 });
  // Pointer ownership, deadzone, response curve and cardinal assist are the engine's
  // `VirtualJoystick` (post-M0 input hardening): the first pointer owns the stick until it lifts or
  // is cancelled, and a second finger — e.g. a camera swipe grazing the stick — changes nothing.
  const surfaceRef = useRef<JoystickSurface | null>(null);
  surfaceRef.current ??= new JoystickSurface({
    publish: (x, y) => sharedControlState.touch.setJoystick(x, y),
    showThumb: (x, y) => setThumb({ x, y }),
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      setMetrics(getJoystickMetrics());
    };

    update();
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      surfaceRef.current?.dispose();
      sharedControlState.touch.setJoystick(0, 0);
    };
  }, []);

  function geometryOf(element: HTMLDivElement) {
    return joystickGeometry(element.getBoundingClientRect(), metrics.thumbSize);
  }

  if (!enabled) {
    return null;
  }

  const radius = metrics.stickSize / 2 - metrics.thumbSize / 2;

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        data-touch-joystick=""
        className="pointer-events-auto fixed rounded-full border border-white/20 bg-black/20 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-md"
        style={{
          width: metrics.stickSize,
          height: metrics.stickSize,
          // Safe-area aware (2B.4C.2): keep clear of notches / home indicator without device-specific numbers.
          left: `calc(${metrics.edgeOffset}px + env(safe-area-inset-left, 0px))`,
          bottom: `calc(${metrics.edgeOffset}px + env(safe-area-inset-bottom, 0px))`,
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          const element = event.currentTarget;
          if (!surfaceRef.current!.down(event.pointerId, event.clientX, event.clientY, geometryOf(element))) {
            return; // another pointer owns the stick: do not capture, do not move
          }
          element.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          surfaceRef.current!.move(event.pointerId, event.clientX, event.clientY, geometryOf(event.currentTarget));
        }}
        onPointerUp={(event) => {
          if (!surfaceRef.current!.up(event.pointerId)) {
            return;
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          surfaceRef.current!.cancel(event.pointerId);
        }}
      >
        <div
          className="absolute rounded-full border border-dashed border-white/20"
          style={{ inset: metrics.outerInset }}
        />
        <div
          className="absolute rounded-full border border-white/12"
          style={{ inset: metrics.innerInset }}
        />
        <div
          data-touch-joystick-thumb=""
          className="absolute left-1/2 top-1/2 rounded-full border border-white/30 bg-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          style={{
            width: metrics.thumbSize,
            height: metrics.thumbSize,
            transform: `translate(calc(-50% + ${thumb.x * radius}px), calc(-50% + ${thumb.y * radius}px))`,
          }}
        />
      </div>
    </div>
  );
}
