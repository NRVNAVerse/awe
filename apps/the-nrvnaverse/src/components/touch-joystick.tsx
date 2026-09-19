"use client";

import { sharedControlState } from "@oncyberio/engine/input";
import { useEffect, useRef, useState } from "react";

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

const DEADZONE = 0.26;
const RESPONSE_EXPONENT = 1.75;
const CARDINAL_ASSIST_RATIO = 0.35;
const CARDINAL_ASSIST_MIN = 0.3;

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

function applyCardinalAssist(x: number, y: number): JoystickPosition {
  const magnitude = Math.hypot(x, y);

  if (magnitude < CARDINAL_ASSIST_MIN) {
    return { x, y };
  }

  const absX = Math.abs(x);
  const absY = Math.abs(y);

  if (absX > absY && absY <= absX * CARDINAL_ASSIST_RATIO) {
    return { x: Math.sign(x) * magnitude, y: 0 };
  }

  if (absY > absX && absX <= absY * CARDINAL_ASSIST_RATIO) {
    return { x: 0, y: Math.sign(y) * magnitude };
  }

  return { x, y };
}

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

export function TouchJoystick() {
  const joystickRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [metrics, setMetrics] = useState<JoystickMetrics>(getJoystickMetrics);
  const [thumbPosition, setThumbPosition] = useState<JoystickPosition>({
    x: 0,
    y: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(pointer: coarse)");
    const update = () => {
      setEnabled(isTouchScreen());
      setMetrics(getJoystickMetrics());
    };

    update();
    media.addEventListener("change", update);
    window.addEventListener("resize", update);

    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      sharedControlState.touch.setJoystick(0, 0);
    };
  }, []);

  function updateJoystick(clientX: number, clientY: number) {
    const joystick = joystickRef.current;

    if (!joystick) {
      return;
    }

    const rect = joystick.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width / 2 - metrics.thumbSize / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    const normalizedDistance = Math.min(distance / radius, 1);
    const adjustedDistance =
      normalizedDistance <= DEADZONE
        ? 0
        : (normalizedDistance - DEADZONE) / (1 - DEADZONE);
    const curvedDistance = adjustedDistance ** RESPONSE_EXPONENT;
    const displayDistance = normalizedDistance <= DEADZONE ? 0 : normalizedDistance;
    const directionX = distance > 0 ? dx / distance : 0;
    const directionY = distance > 0 ? dy / distance : 0;
    const displayVector = applyCardinalAssist(
      directionX * displayDistance,
      directionY * displayDistance,
    );
    const outputVector = applyCardinalAssist(
      directionX * curvedDistance,
      -directionY * curvedDistance,
    );

    setThumbPosition({
      x: displayVector.x * radius,
      y: displayVector.y * radius,
    });

    sharedControlState.touch.setJoystick(outputVector.x, outputVector.y);
  }

  function resetJoystick() {
    pointerIdRef.current = null;
    setThumbPosition({ x: 0, y: 0 });
    sharedControlState.touch.setJoystick(0, 0);
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        ref={joystickRef}
        className="pointer-events-auto fixed rounded-full border border-white/20 bg-black/20 shadow-[0_18px_50px_rgba(0,0,0,0.28)] backdrop-blur-md"
        style={{
          width: metrics.stickSize,
          height: metrics.stickSize,
          left: metrics.edgeOffset,
          bottom: metrics.edgeOffset,
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          pointerIdRef.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          updateJoystick(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current !== event.pointerId) {
            return;
          }

          updateJoystick(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (pointerIdRef.current !== event.pointerId) {
            return;
          }

          event.currentTarget.releasePointerCapture(event.pointerId);
          resetJoystick();
        }}
        onPointerCancel={(event) => {
          if (pointerIdRef.current !== event.pointerId) {
            return;
          }

          resetJoystick();
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
          className="absolute left-1/2 top-1/2 rounded-full border border-white/30 bg-white/20 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-sm"
          style={{
            width: metrics.thumbSize,
            height: metrics.thumbSize,
            transform: `translate(calc(-50% + ${thumbPosition.x}px), calc(-50% + ${thumbPosition.y}px))`,
          }}
        />
      </div>
    </div>
  );
}
