import { isPublicStatus, type Destination } from "@nrvnaverse/manifest";

/**
 * Which destinations have an in-world web-context panel (`/web-context/<id>`, M1 D-020; M4 privacy):
 * public and UNGATED only. A gated destination has no threshold, so no panel is generated, linked
 * or requested for it — no overview of gated content is published by the world.
 */
export function hasWebContext(d: Pick<Destination, "status" | "gates">): boolean {
  return isPublicStatus(d.status) && d.gates.length === 0;
}

/** The ids that get a static web-context page (`generateStaticParams`). */
export function webContextIds(destinations: readonly Pick<Destination, "id" | "status" | "gates">[]): string[] {
  return destinations.filter(hasWebContext).map((d) => d.id);
}
