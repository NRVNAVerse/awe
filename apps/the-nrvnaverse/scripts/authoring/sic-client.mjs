// @ts-check
/**
 * Minimal stdio MCP client for Spatial Intelligence Core (dependency-free; M3 Mission B).
 *
 * SIC is a separate, read-only tool on this machine (`SIC_ROOT`, default `C:/Dev/spatial-intelligence-core`).
 * The authoring dry run starts its MCP server as a child process, calls read-only tools
 * (`blender_scene` load from a saved export, `clearance`, `query_relation`) and stops it. Nothing in
 * NRVNAVerse modifies SIC, and no SIC tool that writes files (`blender_edit`) is ever called.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_SIC_ROOT = "C:/Dev/spatial-intelligence-core";

/** The SIC checkout to use, or null when it is not present. */
export function sicRoot() {
  const root = process.env.SIC_ROOT ?? DEFAULT_SIC_ROOT;
  return existsSync(join(root, "src", "mcp", "main.ts")) ? root : null;
}

/** Tools the dry run may call (all `readOnlyHint`); anything else is refused client-side. */
const READ_ONLY_TOOLS = new Set(["blender_scene", "clearance", "query_relation", "scene_summary", "inspect_object"]);

/**
 * @param {string} root
 */
export async function startSic(root) {
  const child = spawn(process.execPath, ["src/mcp/main.ts"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  /** @type {string[]} */
  const stderr = [];
  child.stderr.on("data", (d) => stderr.push(String(d)));
  let buffer = "";
  /** @type {Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>} */
  const pending = new Map();
  let nextId = 1;
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      /** @type {any} */
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const p = /** @type {{ resolve: (v: any) => void; reject: (e: Error) => void }} */ (pending.get(msg.id));
        pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    }
  });
  child.on("exit", () => {
    for (const p of pending.values()) p.reject(new Error(`SIC exited: ${stderr.join("").slice(-500)}`));
    pending.clear();
  });
  /** @param {string} method @param {Record<string, unknown>} params @returns {Promise<any>} */
  const request = (method, params) => {
    const id = nextId++;
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  await request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "nrvnaverse-authoring", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n");

  return {
    /**
     * Call one read-only tool; resolves to its structured content (throws on a tool error).
     * @param {string} name @param {Record<string, unknown>} args @returns {Promise<any>}
     */
    async call(name, args) {
      if (!READ_ONLY_TOOLS.has(name)) throw new Error(`refusing SIC tool "${name}" (not in the read-only set)`);
      const result = await request("tools/call", { name, arguments: args });
      const structured = result?.structuredContent;
      if (result?.isError) throw new Error(`SIC ${name}: ${JSON.stringify(structured ?? result.content).slice(0, 600)}`);
      if (structured !== undefined) return structured;
      const text = result?.content?.find((/** @type {any} */ c) => c.type === "text")?.text;
      return text ? JSON.parse(text) : result;
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}
