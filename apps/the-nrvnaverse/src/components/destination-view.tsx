import type { DeepLinkEntry, Destination, DestinationIndex } from "@nrvnaverse/manifest";

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
 */
export function DestinationView({ destination, entry, index, debug = false }: DestinationViewProps) {
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {destination.kind}
        {district && district.id !== destination.id ? ` · ${district.name}` : ""}
      </p>
      <h2 className="text-xl font-semibold">{destination.name}</h2>
      <p className="mt-1 text-sm text-neutral-300">{destination.description}</p>
      {destination.gates.length > 0 && (
        <p className="mt-2 text-sm text-amber-300" data-visitor-gate>
          Access to this destination is restricted and not available in the world yet.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <a className="underline" href={destination.webUrl}>
          More on nrvnaverse.com
        </a>
        {entry.returnUrl && (
          <a className="underline" href={entry.returnUrl}>
            Back to where you came from
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
          <a className="underline" href={destination.webUrl}>
            {destination.webUrl}
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
