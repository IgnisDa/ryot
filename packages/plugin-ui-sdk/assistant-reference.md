## Page presentation guidance

Use SDK components and theme tokens for consistent page layout. Charts, tables, Markdown, icons,
sync marks and schema forms have the exact public subpaths listed below. Their implementation
dependencies are private. Use bridged `compact` and safe-area values from `useRyotViewport`,
not iframe media queries or CSS `env()`. Use `QueryStatus` around decoded query data and
`LoadMoreButton` with `isFetchingNextPage` for paginated results. Load more, filtering and detail
navigation must be disabled for snapshot publications.

Choose a `MetricUnit` using `countUnit`, `durationUnit`, `measureUnit` or `percentUnit`; pass that
same unit to figures and chart axes. Reporting charts take an explicit reporting time zone.
A missing value is `null`, distinct from zero. Charts render supplied aggregates; declared queries
own data selection and aggregation. Use `EntityArtWell` for missing artwork and presentation
helpers for entity cards instead of reconstructing plugin-specific fields.

### Compact aggregate presentation

```tsx
import { useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { countUnit, MetricGrid } from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";

export default function AggregatePresentation() {
  const { compact } = useRyotViewport();
  return (
    <main className="space-y-4 p-4">
      <MetricGrid
        compact={compact}
        variant="panel"
        comparisonLabel=""
        metrics={[{ key: "recorded", label: "Recorded", value: 12, unit: countUnit("item") }]}
      />
      <RankedBarList
        rows={[{ key: "recorded", label: "Recorded", value: 12 }]}
        formatValue={(row) => String(row.value)}
      />
    </main>
  );
}
```
