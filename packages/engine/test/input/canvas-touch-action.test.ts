/**
 * The render canvas opts out of browser touch gestures.
 *
 * With the default `touch-action`, a second finger on the canvas makes the
 * pair a candidate pinch; when the browser claims it, it cancels every
 * captured pointer — including one an on-screen joystick holds — so movement
 * dies under a finger that never moved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../../src/internal/utils/ua-parser");
  vi.resetModules();
});

describe("render canvas", () => {
  it("is created with touch-action: none", async () => {
    const created: Array<{ tagName: string; style: Record<string, unknown> }> = [];

    vi.resetModules();
    // The UA parser is a UMD bundle whose named export only resolves in a
    // real browser; the device class is irrelevant here.
    vi.doMock("../../src/internal/utils/ua-parser", () => ({
      UAParser: () => ({ browser: {}, os: {}, device: { type: "mobile" } }),
    }));
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      getGamepads: () => [],
    });
    vi.stubGlobal("document", {
      createElement: (tagName: string) => {
        const element = { tagName, style: {} as Record<string, unknown> };
        created.push(element);
        return element;
      },
    });
    vi.stubGlobal("window", {
      innerWidth: 390,
      innerHeight: 844,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    const { CANVAS } = await import("../../src/internal/constants");

    expect(CANVAS).not.toBeNull();
    expect((CANVAS as unknown as { style: Record<string, unknown> }).style.touchAction).toBe(
      "none",
    );
  });
});
