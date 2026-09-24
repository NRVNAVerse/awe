// @ts-check
import conf from "./utils/params";
import { UAParser } from "./utils/ua-parser";
import offscreenWebglTest from "./utils/offscreen-webgl-test";
import { deferred } from "./utils/deferred";
import { Assets } from "./resources/assets";
import type { TierResult } from "detect-gpu";

export const FRONT_END = typeof window !== "undefined";

type ProcessLike = {
    env?: {
        NODE_ENV?: string;
    };
};

const NODE_PROCESS =
    "process" in globalThis
        ? (globalThis as typeof globalThis & { process?: ProcessLike }).process
        : undefined;

const uaParser = FRONT_END ? UAParser(navigator.userAgent) : null;

let isSafari = false;
let isFirefox = false;
let firefoxVersion = 0;

if (FRONT_END) {
    //
    if (NODE_PROCESS?.env?.NODE_ENV === "development") {
        //
        globalThis["$uaParser"] = uaParser;
    }

    const browser = uaParser.browser;
    isSafari = browser?.name === "Safari";
    isFirefox = browser?.name === "Firefox";
    firefoxVersion = isFirefox ? parseInt(browser?.major ?? 0) : -1;
}

export const OS = FRONT_END ? uaParser.os : null;

const deviceType = FRONT_END ? uaParser.device.type : null;

export let IS_DESKTOP = deviceType != "tablet" && deviceType != "mobile";

export let IS_MOBILE = IS_DESKTOP != true;

export const IS_MAC = FRONT_END ? uaParser.os?.name === "Mac OS" : false;

export const IS_TOUCH = IS_MOBILE;

export let CANVAS = null;

if (FRONT_END) {
    CANVAS = document.createElement("canvas");
    CANVAS.style.width = "100%";
    CANVAS.style.height = "100%";
    CANVAS.style.outline = "none";
    CANVAS.style.position = "absolute";
    CANVAS.style.left = 0;
    CANVAS.style.top = 0;
    CANVAS.style.maxWidth = "100%";
    CANVAS.style.maxHeight = "100%";
    // The browser must never claim a canvas-originating touch for panning or
    // pinch-zoom. It is not just that the page would scroll: a second finger
    // landing on a canvas with the default `touch-action` makes the pair a
    // candidate pinch gesture, and when the browser takes the gesture it fires
    // pointercancel on *every* captured pointer — including one an on-screen
    // joystick holds on its own overlay. Movement then dies under a finger
    // that never moved. three.js OrbitControls does the same, for this reason.
    CANVAS.style.touchAction = "none";
    CANVAS.id = "game-canvas";
}

export const FPS = Number(conf.fps);

export const IS_POINTER_LOCK = () =>
    FRONT_END ? document.pointerLockElement === CANVAS : null;

export const DEBUG = conf.debug;

export const DEBUG_PHYSICS = conf.debugphysics;

export const DEBUG_COLLISION = conf.debugCollision;

export const DEBUG_BOX = conf.debugbox;

export const FBO_DEBUG = conf.debugfbo;

export const STATS = conf.stats;

export const DEBUG_AUDIO = conf.debugaudio == true;

export let DPI = FRONT_END ? Math.min(window.devicePixelRatio, 2) : null;
// export let DPI = FRONT_END ? 1 : null;

export let REAL_DPI = DPI;

export let SET_REAL_DPI = function (val) {
    REAL_DPI = val;
};

export const QUALITIES = {
    HIGH: "high",
    MEDIUM: "medium",
    LOW: "low",
} as const;

// export let QUALITY = IS_MOBILE ? QUALITIES.LOW : QUALITIES.HIGH;
export let QUALITY = QUALITIES.HIGH;

export const WEB_WORKER_SUPPORT = typeof Worker !== "undefined";

export const WEBWORK_DELAY = conf.webworkdelay ? conf.webworkdelay : false;

export const DEBUG_WEBWORK = conf.webwork == true;

let canvasTest = FRONT_END ? document.createElement("canvas") : null;

export let SUPPORT_OFFSCREEN_CANVAS = canvasTest
    ? typeof canvasTest.transferControlToOffscreen === "function"
    : false;

canvasTest = null;

export let SUPPORT_OFFSCREEN_CANVAS_WEBGL = offscreenWebglTest(
    SUPPORT_OFFSCREEN_CANVAS,
    WEB_WORKER_SUPPORT
);

export let BITMAP_SUPPORT =
    typeof createImageBitmap !== "undefined" &&
    !isSafari &&
    !(isFirefox && firefoxVersion < 98);

export let GPU_TIER: TierResult = {} as TierResult;

export let SET_GPU_TIER = function (val: TierResult) {
    console.log("GPU TIER : ", val);
    GPU_TIER = val;
};

export let COMPRESSED_SUPPORT = false;

export let SET_COMPRESSED_SUPPORT = function (values) {
    let support = false;

    for (const property in values) {
        support = support || values[property];
    }

    COMPRESSED_SUPPORT = support;

    // console.log("COMPRESSED_SUPPORT", COMPRESSED_SUPPORT);
};

export const LANDSCAPE = "landscape";

export const PORTRAIT = "portrait";

export let ORIENTATION = null;

export let SET_ORIENTATION = function (val) {
    ORIENTATION = val;
};

export let CSS_CANVAS = null;

export function SET_CSS_CANVAS(val) {
    CSS_CANVAS = val;
}
export let CSS_FACTOR = 60;

export let VIEW = {
    w: 0,
    h: 0,
};

export let REAL_VIEW = {
    w: 0,
    h: 0,
};

export let SET_VIEW = (w, h) => {
    VIEW.w = w;
    VIEW.h = h;
};

export let SET_REAL_VIEW = (w, h) => {
    REAL_VIEW.w = w;
    REAL_VIEW.h = h;
};

export let IS_VR_SUPPORTED = null;

export const SET_VR_SUPPORTED = (val) => {
    IS_VR_SUPPORTED = val;
};

export let IS_VR = false;

export const SET_VR = (val) => {
    IS_VR = val;
};

export let SHADOW_NEEDS_UPDATE = false;

export function SET_SHADOW_NEEDS_UPDATE(val) {
    SHADOW_NEEDS_UPDATE = val;
}

if (FRONT_END) {
    // @ts-ignore
    window.SET_SHADOW_NEEDS_UPDATE = SET_SHADOW_NEEDS_UPDATE;
}

const MFER_AVATAR_PICTURE = Assets.images.mferAvatarPic;

export let DEFAULT_PLAYER_AVATAR_PICTURE = MFER_AVATAR_PICTURE;

const SUNSHINE_VRM = Assets.vrms.sunshine;

export let DEFAULT_AVATAR_VRM = SUNSHINE_VRM;

export const LOD_VRM_DISTANCE = 150;

export const LOD_VRM_VISIBILITY = 300;

export const LOD_VRM = Assets.vrms.lod;

export const FPS_BAKING = 60;

export const MAX_INSTANCES = 200;

export const MINIMUM_VRM_BOX = 1.0;

export const MAXIMUM_VRM_BOX = 2.7;

export const MINIMUM_MIX_RATIO = (1 * MINIMUM_VRM_BOX) / MAXIMUM_VRM_BOX;

export const GLOBAL_TEXT_SCALE = 0.02 * 0.4;

export let FONT_DISTANCE_RANGE_FIELD = 0;

export let SET_FONT_DISTANCE_RANGE_FIELD = function (val) {
    FONT_DISTANCE_RANGE_FIELD = val;
};

export const CAMERA_LAYERS = {
    DYNAMIC: 1,
    EDITOR: 2,
};

let userInteraction = deferred();

export const USER_INTERACTED = userInteraction.promise;

export const SET_USER_INTERACTED = () => {
    // console.trace("SET_USER_INTERACTED", val);
    userInteraction.resolve(true);
};

{
    if (FRONT_END) {
        const handleUserInteraction = () => {
            SET_USER_INTERACTED();
        };

        const opts = { once: true, capture: true };
        window.addEventListener("touchend", handleUserInteraction, opts);
        window.addEventListener("click", handleUserInteraction, opts);
    }
}

export let IS_EDIT_MODE = false;

export const SET_EDIT_MODE = (val: boolean) => {
    //
    IS_EDIT_MODE = val;
};

export let IS_SERVER_MODE = typeof window === "undefined";

export const SET_SERVER_MODE = (val: boolean) => {
    if (typeof window === "undefined") {
        console.error("Cannot disable server mode in non-web build");
        return;
    }
    IS_SERVER_MODE = val;
};
