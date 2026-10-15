import destinationsJson from "@nrvnaverse/manifest/generated/destinations.json";
import { buildDeepLinkQuery, createDestinationIndex, isPublicStatus, NRVNAVERSE_SPATIAL_ROOT, type DestinationsFile } from "@nrvnaverse/manifest";
import { notFound } from "next/navigation";
import { APP_IDENTITY } from "@/lib/app-identity";

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
 */

const data = destinationsJson as unknown as DestinationsFile;
const index = createDestinationIndex(data.destinations);

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return data.destinations.filter((d) => isPublicStatus(d.status)).map((d) => ({ id: d.id }));
}

export default async function WebContextPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const destination = index.byId.get(id);
  if (!destination || !isPublicStatus(destination.status)) notFound();
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;
  const spatialUrl = `${NRVNAVERSE_SPATIAL_ROOT.replace(/\/$/, "")}/${buildDeepLinkQuery(destination.id, { from: "web" })}`;
  const gated = destination.gates.length > 0;

  return (
    <main className="min-h-screen bg-neutral-950 px-5 py-5 text-neutral-100" data-web-context={destination.id}>
      <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/70">
        {APP_IDENTITY.ecosystem} · {destination.kind}
        {district && district.id !== destination.id ? ` · ${district.name}` : ""}
      </p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{destination.name}</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-neutral-300">{destination.description}</p>
      {destination.categories.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">{destination.categories.join(" · ")}</p>
      )}
      {gated && (
        <p className="mt-3 rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200" data-web-context-gate>
          Access to this destination is restricted. The spatial entry is refused at the gate; the web page explains the conditions.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <a className="w-fit rounded border border-amber-300/50 bg-amber-300/10 px-3 py-1.5 font-medium text-amber-100 hover:bg-amber-300/20" href={destination.webUrl} target="_blank" rel="noopener noreferrer" data-web-context-link="canonical">
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
