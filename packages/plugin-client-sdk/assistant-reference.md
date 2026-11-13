## Page authoring conventions

A page definition contains `entry`, base64-encoded `files`, `pluginDependencies`, `queries` and
optional `pluginQueries`.
Use an entry such as `client/page.tsx` exporting a React component as default, with no required
props. The host mounts it with the SDK providers; do not call bootstrap or create a React root.
Keep source files under `client/**` and environment-neutral helpers under `shared/**`.
Only the supported author imports listed below are available; package exports alone do not grant
compiler access. Use `@ryot-app/plugin-client-sdk/effect` for Effect and Schema. Shared files may
import only neutral `@ryot-app/plugin-kit/*` entries listed below, and relative shared files.
Plugin component imports require a declared dependency and the public
`@ryot-app/plugins/<dependency-alias>/<export>` path; discover real exports before using them.

Prefer a dependency's declared query over writing your own: find them with `search`, add the
result's `dependency` reference to `pluginDependencies` under an alias, and map a local name to the
alias and query in `pluginQueries`, for example
`{ "series": { "dependency": "fitness", "query": "measurement-series" } }`. Each of its named queries
runs as `<local>.<query>`, such as `series.averages`, and shares the page's parameters; a parameter
defined differently by two sources fails compilation. Otherwise put one static RyotQL document in
`queries`, with named queries and typed AppSchema parameters. Find tables, fields, entity schemas and
their properties with `kernel:data.describe`; do not invent names. Every compile validates both, and
a `definition-invalid` result names the broken query. Execute names through
`client.page.query(name, request)`. The request carries runtime `arguments`, `filter`, `sort`,
`pages` and a Result-returning `decode`. `client.page.describe(name, arguments?)` discovers controls
and parameter metadata. Do not send inline documents, saved-view queries or references to another
page from a page.
Decode responses with source-owned schemas or recipe decoders, and derive types from schemas.

Use `EntityResults` from `@ryot-app/plugin-client-sdk/plugin` for entity cards. Select the owning
plugin's presentation fields in the declared query, then pass the selected sources and references
to that component. Its projection uses the registered presentation's `prepare`; missing or invalid
fields fail rather than fetching data through a presentation loader. Generic metrics and charts
can render decoded aggregate fields directly.

Compile the saved draft, inspect diagnostics, repair its source and compile again before preview.
Draft preview identity consists of the compiled draft revision, definition hash and artifact hash;
use the compile tool's returned identity unchanged. Editing invalidates that identity. Preview is
read-only. Publishing is a separate owner-approved write; assistant edits clear page write access.
Plugin operations on a published page need the owner's grant. Visitors cannot perform writes.

### Declared aggregate query page

This component expects a declared query named `summary` whose aggregate output selects a numeric
`total` (for example a count aggregate). Keep its decoder beside its query recipe.

```tsx
import { Schema } from "@ryot-app/plugin-client-sdk/effect";
import { useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { countUnit, MetricGrid, QueryStatus } from "@ryot-app/plugin-ui-sdk";

const SummaryResponse = Schema.Struct({
  data: Schema.Struct({
    summary: Schema.Struct({
      type: Schema.Literal("aggregate"),
      items: Schema.Array(Schema.Struct({ total: Schema.Number })),
    }),
  }),
});
const summaryQuery = createRyotQuery(({ client }) =>
  client.page.query("summary", { decode: Schema.decodeUnknownResult(SummaryResponse) }),
);

export default function SummaryPage() {
  const { compact } = useRyotViewport();
  const query = useRyotQuery(summaryQuery);
  return (
    <main className="p-4">
      <QueryStatus label="summary" query={query} onRetry={query.refetch}>
        {(response) => (
          <MetricGrid
            compact={compact}
            variant="tiles"
            comparisonLabel=""
            metrics={[
              {
                key: "total",
                label: "Total",
                unit: countUnit("item"),
                value: response.data.summary.items[0]?.total ?? 0,
              },
            ]}
          />
        )}
      </QueryStatus>
    </main>
  );
}
```
