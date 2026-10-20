import type { DeepLinkEntry, Destination, DestinationIndex } from "@nrvnaverse/manifest";
import { currentPageLabel, returnLabel, webUrlOf } from "@/lib/deployment/web-links";
import { presentDescription } from "@/lib/present-description";

interface DestinationViewProps {
  destination: Destination;
  entry: DeepLinkEntry;
  index: DestinationIndex;
  /** Diagnostics gate (`useDebugMode`): manifest ids, slug, capabilities and entry params. */
  debug?: boolean;
}

/**
 * Current destination card. Visitors see the name, what it is, its district, any access
 * restriction in plain words and links to the web; the manifest-level detail (ids, slug,
 * capabilities, entry params) is diagnostics only. Gates are displayed and refused at the spatial
 * boundary, not verified (M0 Step 2A).
 *
 * M4 return contract: two links to the website, both canonical pages on this build's website origin —
 * the page of the place the visitor is in now, and the way back the deep link asked for (`return`,
 * kept through in-world travel). When both name the same page only the way back is shown.
 */
export function DestinationView({ destination, entry, index, debug = false }: DestinationViewProps) {
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;
  const pageUrl = webUrlOf(destination);
  const back = entry.returnUrl ? { href: entry.returnUrl, label: returnLabel(index, entry.returnToken) ?? "Back to nrvnaverse.com" } : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {destination.kind}
        {district && district.id !== destination.id ? ` · ${district.name}` : ""}
      </p>
      <h2 className="text-xl font-semibold">{destination.name}</h2>
      <p className="mt-1 text-sm text-neutral-300">{presentDescription(destination.description)}</p>
      {destination.gates.length > 0 && (
        <p className="mt-2 text-sm text-amber-300" data-visitor-gate>
          Access to this destination is restricted and not available in the world yet.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {(!back || back.href !== pageUrl) && (
          <a className="underline" href={pageUrl} data-web-link="current">
            {currentPageLabel(destination)}
          </a>
        )}
        {back && (
          <a className="underline" href={back.href} data-web-link="return">
            {back.label}
          </a>
        )}
      </div>

      {debug && (
      <dl data-debug="destination" className="mt-4 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">id</dt>
        <dd>
          <code>{destination.id}</code>
        </dd>
        <dt className="text-neutral-500">slug</dt>
        <dd>
          <code>{destination.slug}</code>
        </dd>
        {district && (
          <>
            <dt className="text-neutral-500">district</dt>
            <dd>{district.name}</dd>
          </>
        )}
        <dt className="text-neutral-500">capabilities</dt>
        <dd>{destination.capabilities.join(", ") || "—"}</dd>
        <dt className="text-neutral-500">gates</dt>
        <dd>
          {destination.gates.length === 0
            ? "none"
            : destination.gates.map((g) => `${g.kind} (declared; spatial entry refused; verification not implemented)`).join(", ")}
        </dd>
        <dt className="text-neutral-500">web</dt>
        <dd className="min-w-0 break-words">
          <a className="underline" href={pageUrl}>
            {pageUrl}
          </a>
        </dd>
        {entry.from && (
          <>
            <dt className="text-neutral-500">from</dt>
            <dd>
              <code>{entry.from}</code>
            </dd>
          </>
        )}
        {entry.ref && (
          <>
            <dt className="text-neutral-500">ref</dt>
            <dd>
              <code>{entry.ref}</code>
            </dd>
          </>
        )}
        {entry.returnUrl && (
          <>
            <dt className="text-neutral-500">return</dt>
            <dd className="min-w-0 break-words">
              <a className="underline" href={entry.returnUrl}>
                {entry.returnUrl}
              </a>
            </dd>
          </>
        )}
      </dl>
      )}
    </section>
  );
}
