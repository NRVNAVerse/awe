"use client";

import { Engine } from "@oncyberio/engine";
import { useEffect, useRef } from "react";

/**
 * Mounts the official AWE engine canvas (upstream `examples/starter` GameCanvas pattern) and keeps
 * it sized to its container. The engine singleton owns the canvas; this component only attaches
 * it once `engine.ready` resolves and detaches it on unmount.
 *
 * Deviation from the starter: resizing also listens to a ResizeObserver on the container, so
 * layout changes that do not fire `window.resize` still resize the renderer.
 */
export function EngineCanvas() {
  const container = useRef<HTMLDivElement>(null);
  const wasInit = useRef(false);

  useEffect(() => {
    const el = container.current;
    if (!el || wasInit.current) return;
    wasInit.current = true;

    const engine = Engine.getInstance();
    let cancelled = false;

    const resize = () => {
      if (!container.current) return;
      const { clientWidth, clientHeight } = container.current;
      if (clientWidth === 0 || clientHeight === 0) return;
      void engine.resize({ w: clientWidth, h: clientHeight });
    };

    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(el);
    window.addEventListener("resize", resize);

    el.textContent = "";
    void engine.ready.then(() => {
      if (cancelled || !container.current) return;
      container.current.appendChild(engine.canvas);
      setTimeout(resize, 0);
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      wasInit.current = false;
      engine.canvas.parentElement?.removeChild(engine.canvas);
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-black" id="exhibit">
      <div id="canvas-container" ref={container} className="absolute inset-0 outline-none pointer-events-auto" />
      {/* Upstream engine UI root (interaction prompts etc.). */}
      <div id="oo-ui-root" className="absolute left-0 top-0 pointer-events-auto" />
    </div>
  );
}
