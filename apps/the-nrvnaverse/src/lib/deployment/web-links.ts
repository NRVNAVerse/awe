import { RETURN_WEB_TOKEN, rebaseWebUrl, type DeepLinkEntry, type Destination, type DestinationIndex } from "@nrvnaverse/manifest";
import { currentDeployment } from "@/lib/deployment/deployment-profile";

/**
 * World → web links (M4). Every link to the website is the destination's CANONICAL page
 * (manifest `webUrl`, derived from its stable id's slug) moved onto this build's reviewed website
 * origin: production → www.nrvnaverse.com, staging → the staging website, local → the local WEB app.
 * Nothing here reads a URL from the visitor. Built with `NRVNA_WEB_PAGES=0` (the website does not
 * serve `/worlds/<slug>` yet), every such link is the website root instead of a dead page.
 */
export function webRoot(): string {
  return `${currentDeployment().webOrigin}/`;
}

/** Whether the website serves per-destination pages (build-time `NRVNA_WEB_PAGES`, default yes). */
export function webPagesAvailable(): boolean {
  return process.env.NRVNA_WEB_PAGES !== "0";
}

export function webUrlOf(destination: Pick<Destination, "webUrl">): string {
  return webPagesAvailable() ? rebaseWebUrl(destination.webUrl, currentDeployment().webOrigin) : webRoot();
}

/** Visitor label for the link to the current place's page. */
export function currentPageLabel(destination: Pick<Destination, "name">): string {
  return webPagesAvailable() ? `${destination.name} on nrvnaverse.com` : "More on nrvnaverse.com";
}

/** The entry with its way back pointed at the website root when there are no destination pages (the token is kept). */
export function withWebPages(entry: DeepLinkEntry): DeepLinkEntry {
  return !webPagesAvailable() && entry.returnUrl !== null ? { ...entry, returnUrl: webRoot() } : entry;
}

/** Visitor label for the way back, from the resolved return token. */
export function returnLabel(index: DestinationIndex, returnToken: string | null): string | null {
  if (returnToken === null) return null;
  if (returnToken === RETURN_WEB_TOKEN || !webPagesAvailable()) return "Back to nrvnaverse.com";
  const destination = index.byId.get(returnToken);
  return destination ? `Back to ${destination.name} on nrvnaverse.com` : "Back to nrvnaverse.com";
}
