import { RETURN_WEB_TOKEN, rebaseWebUrl, type Destination, type DestinationIndex } from "@nrvnaverse/manifest";
import { currentDeployment } from "@/lib/deployment/deployment-profile";

/**
 * World → web links (M4). Every link to the website is the destination's CANONICAL page
 * (manifest `webUrl`, derived from its stable id's slug) moved onto this build's reviewed website
 * origin: production → www.nrvnaverse.com, staging → the staging website, local → the local WEB app.
 * Nothing here reads a URL from the visitor.
 */
export function webRoot(): string {
  return `${currentDeployment().webOrigin}/`;
}

export function webUrlOf(destination: Pick<Destination, "webUrl">): string {
  return rebaseWebUrl(destination.webUrl, currentDeployment().webOrigin);
}

/** Visitor label for the way back, from the resolved return token. */
export function returnLabel(index: DestinationIndex, returnToken: string | null): string | null {
  if (returnToken === null) return null;
  if (returnToken === RETURN_WEB_TOKEN) return "Back to nrvnaverse.com";
  const destination = index.byId.get(returnToken);
  return destination ? `Back to ${destination.name} on nrvnaverse.com` : "Back to nrvnaverse.com";
}
