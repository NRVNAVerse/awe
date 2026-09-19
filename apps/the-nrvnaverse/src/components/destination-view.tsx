import type { DeepLinkEntry, Destination, DestinationIndex } from "@nrvnaverse/manifest";

interface DestinationViewProps {
  destination: Destination;
  entry: DeepLinkEntry;
  index: DestinationIndex;
}

/** Current destination card. Shows manifest data as-is; gates are displayed, not enforced (M0 Step 1). */
export function DestinationView({ destination, entry, index }: DestinationViewProps) {
  const district = destination.primaryDistrictId ? index.byId.get(destination.primaryDistrictId) : null;

  return (
    <section className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{destination.kind}</p>
      <h2 className="text-xl font-semibold">{destination.name}</h2>
      <p className="mt-1 text-sm text-neutral-300">{destination.description}</p>

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
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
            : destination.gates.map((g) => `${g.kind} (declared, not enforced in M0 Step 1)`).join(", ")}
        </dd>
        <dt className="text-neutral-500">web</dt>
        <dd>
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
            <dd>
              <a className="underline" href={entry.returnUrl}>
                {entry.returnUrl}
              </a>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
