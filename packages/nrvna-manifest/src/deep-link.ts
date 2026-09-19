import { resolveDestination, type DestinationIndex, type DestinationResolution } from "./resolve";
import { DESTINATION_QUERY_PARAM, NRVNAVERSE_WEB_ROOT, isDestinationId, isPublicStatus } from "./schema";

/**
 * Spatial deep-link contract (D-003, D-004):
 *
 *   worlds.nrvnaverse.com/?destination=<stable-id>[&from=<source>][&ref=<code>][&return=<id|web>]
 *
 * Only these four parameters are read. `return` is a *token* that resolves through manifest
 * data (a destination id → its `webUrl`) or the literal `web` (→ the web root). It is never a
 * URL, so it can never become an open redirect.
 *
 * The experimental `?chunk=` parameter is not part of this contract and is ignored.
 */
export const DEEP_LINK_PARAMS = [DESTINATION_QUERY_PARAM, "from", "ref", "return"] as const;
export type DeepLinkParam = (typeof DEEP_LINK_PARAMS)[number];

/** Traffic source token, e.g. `web`, `portal`, `qr`, `share`. Lowercase kebab-case, ≤32 chars. */
export const FROM_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
/** Referral / campaign code. ≤64 URL-safe chars. */
export const REF_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
/** `return` token: a destination id or the literal `web`. */
export const RETURN_WEB_TOKEN = "web";

export interface DeepLinkParams {
  destination: string | null;
  from: string | null;
  ref: string | null;
  return: string | null;
}

export type DeepLinkIssueCode =
  | "invalid-destination"
  | "invalid-from"
  | "invalid-ref"
  | "unsafe-return"
  | "ignored-param";

export interface DeepLinkIssue {
  code: DeepLinkIssueCode;
  param: string;
  message: string;
}

export interface ParsedDeepLink {
  params: DeepLinkParams;
  issues: DeepLinkIssue[];
}

function toSearchParams(input: string | URLSearchParams | URL): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  if (input instanceof URL) return input.searchParams;
  return new URLSearchParams(input.startsWith("?") ? input.slice(1) : input);
}

/**
 * Parse and allow-list the deep-link query. Malformed values are dropped and reported as
 * non-fatal issues; unknown parameters are ignored and reported.
 */
export function parseDeepLink(input: string | URLSearchParams | URL): ParsedDeepLink {
  const search = toSearchParams(input);
  const issues: DeepLinkIssue[] = [];
  const params: DeepLinkParams = { destination: null, from: null, ref: null, return: null };

  for (const key of new Set(search.keys())) {
    if (!(DEEP_LINK_PARAMS as readonly string[]).includes(key)) {
      issues.push({ code: "ignored-param", param: key, message: `"${key}" is not part of the deep-link contract and was ignored` });
    }
  }

  const destination = search.get(DESTINATION_QUERY_PARAM);
  if (destination !== null) {
    if (isDestinationId(destination)) params.destination = destination;
    else issues.push({ code: "invalid-destination", param: DESTINATION_QUERY_PARAM, message: "destination must be a stable destination id" });
  }

  const from = search.get("from");
  if (from !== null) {
    if (FROM_PATTERN.test(from)) params.from = from;
    else issues.push({ code: "invalid-from", param: "from", message: "from must be a lowercase kebab-case source token" });
  }

  const ref = search.get("ref");
  if (ref !== null) {
    if (REF_PATTERN.test(ref)) params.ref = ref;
    else issues.push({ code: "invalid-ref", param: "ref", message: "ref must be 1-64 URL-safe characters" });
  }

  const ret = search.get("return");
  if (ret !== null) {
    if (ret === RETURN_WEB_TOKEN || isDestinationId(ret)) params.return = ret;
    else issues.push({ code: "unsafe-return", param: "return", message: "return must be a destination id or \"web\"; URLs are not accepted" });
  }

  return { params, issues };
}

/**
 * Resolve the `return` token to a concrete https URL using manifest data only.
 * Returns null when the token is absent, unknown, or points at a non-public destination.
 */
export function resolveReturnUrl(index: DestinationIndex, token: string | null, webRoot: string = NRVNAVERSE_WEB_ROOT): string | null {
  if (token === null) return null;
  if (token === RETURN_WEB_TOKEN) return webRoot;
  if (!isDestinationId(token)) return null;
  const destination = index.byId.get(token);
  if (!destination || !isPublicStatus(destination.status)) return null;
  return destination.webUrl;
}

export interface DeepLinkEntry {
  resolution: DestinationResolution;
  from: string | null;
  ref: string | null;
  /** Concrete return URL resolved through manifest data, or null. */
  returnUrl: string | null;
  issues: DeepLinkIssue[];
}

/** One-shot: parse the query, resolve the destination (hub fallback) and the return URL. */
export function resolveDeepLink(index: DestinationIndex, input: string | URLSearchParams | URL): DeepLinkEntry {
  const { params, issues } = parseDeepLink(input);
  const resolution = resolveDestination(index, params.destination);
  const returnUrl = resolveReturnUrl(index, params.return);
  if (params.return !== null && returnUrl === null) {
    issues.push({ code: "unsafe-return", param: "return", message: "return token does not resolve to a public destination" });
  }
  return { resolution, from: params.from, ref: params.ref, returnUrl, issues };
}

/** Build a canonical spatial deep-link query for a destination. */
export function buildDeepLinkQuery(destinationId: string, handoff: Partial<Omit<DeepLinkParams, "destination">> = {}): string {
  const search = new URLSearchParams();
  search.set(DESTINATION_QUERY_PARAM, destinationId);
  if (handoff.from) search.set("from", handoff.from);
  if (handoff.ref) search.set("ref", handoff.ref);
  if (handoff.return) search.set("return", handoff.return);
  return `?${search.toString()}`;
}
