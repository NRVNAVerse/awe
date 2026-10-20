import destinationsJson from "@nrvnaverse/manifest/generated/destinations.json";
import { buildDeepLinkQuery, createDestinationIndex, type DestinationsFile } from "@nrvnaverse/manifest";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { APP_IDENTITY } from "@/lib/app-identity";
import { currentDeployment } from "@/lib/deployment/deployment-profile";
import { webPagesAvailable, webUrlOf } from "@/lib/deployment/web-links";
import { hasWebContext, webContextIds } from "@/lib/web/web-context-policy";
import { presentDescription } from "@/lib/present-description";

/**
 * Web-context surface (M1 experience campaign, D-020): the canonical WEB context of one destination,
 * served by THE NRVNAVerse itself so the spatial shell can show it in a same-origin window while the
 * visitor stands in a threshold. It is derived from the manifests only (name, kind, district,
 * description, canonical `webUrl`) and never duplicates the website: every link points at the
 * canonical page on www.nrvnaverse.com, and the spatial link is the stable-id deep link back into
 * the exact room (D-003 / D-004). Static at build time; only public destinations exist here.
 *
 * Why not the engine's in-world `iframe` component for this: it forces an absolute `https://` URL,
 * and a static chunk payload cannot name the deployment origin (local / staging / production), so
 * an in-world frame of THIS page would only work in production. The shell window below is the
 * safe, application-owned mechanism; the canonical site's own frame policy is never relied on.
 *
 * M4 (indexing / privacy): pages exist ONLY for public, UNGATED destinations — a gated destination
 * has no in-world threshold and therefore no panel, so no overview of it is published here (it 404s
 * like any unknown id; the website owns the age-boundary page). Every panel is `noindex, nofollow`
 * (also sent as `X-Robots-Tag`) with the canonical web page as its canonical URL: the panel is a
 * view of website content, never a search result. Links follow the build's deployment profile, so
 * a staging world's panels point at the staging website.
 */

const data = destinationsJson as unknown as DestinationsFile;
const index = createDestinationIndex(data.destinations);
const deployment = currentDeployment();

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return webContextIds(data.destinations).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const destination = index.byId.get(id);
  return {
    robots: { index: false, follow: false },
    alternates: destination && hasWebContext(destination) && webPagesAvailable() ? { canonical: webUrlOf(destination) } : undefined,
  };
}

export default async function WebContextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const destination = index.byId.get(id);
  if (!destination || !hasWebContext(destination)) notFound();
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;
  const spatialUrl = `${deployment.worldOrigin}/${buildDeepLinkQuery(destination.id, { from: "web" })}`;
  const webUrl = webUrlOf(destination);

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-5 text-neutral-100" data-web-context={destination.id}>
      <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/70">
        {APP_IDENTITY.ecosystem} · {destination.kind}
        {district && district.id !== destination.id ? ` · ${district.name}` : ""}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{destination.name}</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-neutral-300">{presentDescription(destination.description)}</p>
      {destination.categories.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">{destination.categories.join(" · ")}</p>
      )}
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <a className="w-fit rounded border border-amber-300/50 bg-amber-300/10 px-3 py-1.5 font-medium text-amber-100 hover:bg-amber-300/20" href={webUrl} target="_blank" rel="noopener noreferrer" data-web-context-link="canonical">
          Open on nrvnaverse.com ↗
        </a>
        <p className="text-xs text-neutral-500">
          Opens the canonical page in a new tab; the world stays where you are.
        </p>
        <p className="mt-2 text-xs text-neutral-500" data-web-context-link="spatial">
          Spatial link for this room: <code className="break-all text-neutral-400">{spatialUrl}</code>
        </p>
      </div>
    </main>
  );
}
