import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { fixtureCatalogs, manifestText } from "./manifest-text";
import { encodePluginSourceFiles, testPluginManifest, testPluginPackageId } from "./test-plugin";

const labels = {
	missing: manifestText("Missing"),
	recorded: manifestText("Recorded"),
	trend: manifestText("Period trend"),
	estimated: manifestText("Estimated"),
	histogram: manifestText("Hourly histogram"),
	current: manifestText("Current period · Sep 1–3, 2026"),
	previous: manifestText("Previous period · Aug 1–3, 2026"),
};

const homeSource = (packageId: string) => `
import { countUnit, useMetricFormat } from "@ryot-app/plugin-ui-sdk";
import { HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { PluginPackageId, TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { useLocalMessage } from "@ryot-app/plugin-client-sdk/react";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { useState } from "react";

const packageId = PluginPackageId.make(${JSON.stringify(packageId)});
const labels = ${JSON.stringify(labels)};

type Detail = "recorded" | "estimated" | "missing";
type TrendPoint = { readonly at: string; readonly value: null | number; readonly detail?: Detail };

const baseTrend: { current: readonly TrendPoint[]; previous: readonly TrendPoint[] } = {
  current: [
    { at: "2026-09-01", value: 0, detail: "recorded" },
    { at: "2026-09-02", value: 4, detail: "estimated" },
    { at: "2026-09-03", value: null, detail: "missing" },
  ],
  previous: [
    { at: "2026-08-01", value: 2 },
    { at: "2026-08-02", value: 1 },
    { at: "2026-08-03", value: 3 },
  ],
};

const trendFor = (
  dataset: "default" | "empty" | "single" | "zero" | "missing-only",
): { readonly current: readonly TrendPoint[]; readonly previous: readonly TrendPoint[] } => {
  if (dataset === "empty") return { current: [], previous: [] };
  if (dataset === "single") return { current: [{ at: "2026-09-01", value: 4, detail: "estimated" }], previous: [] };
  if (dataset === "zero") {
    return { current: [{ at: "2026-09-01", value: 0 }], previous: [{ at: "2026-08-01", value: 0 }] };
  }
  if (dataset === "missing-only") {
    return {
      current: [{ at: "2026-09-01", value: null, detail: "missing" }],
      previous: [{ at: "2026-08-01", value: null, detail: "missing" }],
    };
  }
  return baseTrend;
};

const unit = countUnit((count) => count === 1 ? "entry" : "entries");

const hoursFor = (dataset: "default" | "empty" | "single" | "zero" | "missing-only") => {
  if (dataset === "empty") return [];
  return Array.from({ length: 24 }, (_, hour): { hour: number; value: number | null; detail: Detail } => {
    if (dataset === "single") {
      return { hour, value: hour === 8 ? 4 : null, detail: hour === 8 ? "estimated" : "missing" };
    }
    if (dataset === "zero") return { hour, value: 0, detail: "recorded" };
    if (dataset === "missing-only") return { hour, value: null, detail: "missing" };
    return {
      hour,
      value: hour === 8 ? 4 : hour === 18 ? null : 0,
      detail: hour === 18 ? "missing" : "recorded",
    };
  });
};

export default function Home() {
  const text = useLocalMessage(packageId);
  const { formatMetric } = useMetricFormat();
  const { compact } = useRyotViewport();
  const [dataset, setDataset] = useState<"default" | "empty" | "single" | "zero" | "missing-only">("default");
  const [selection, setSelection] = useState("Not selected");
  const timeZone = TimeZone.make("America/New_York");
  const trendBuckets = trendFor(dataset);
  const formatDetail = <Point extends { detail?: Detail },>({ detail, ...point }: Point) => ({
    ...point,
    detail: detail === undefined ? undefined : text(labels[detail]),
  });
  const hourlyBuckets = hoursFor(dataset).map(formatDetail);

  return <PluginScreenFrame title="Reporting charts">
    <div className="flex min-w-0 flex-col gap-4 p-4">
      <div className="flex flex-wrap gap-2" aria-label="Chart dataset controls">
        <button className="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 text-sm" type="button" onClick={() => setDataset("empty")}>Show empty data</button>
        <button className="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 text-sm" type="button" onClick={() => setDataset("single")}>Show single value</button>
        <button className="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 text-sm" type="button" onClick={() => setDataset("zero")}>Show zero-only data</button>
        <button className="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 text-sm" type="button" onClick={() => setDataset("missing-only")}>Show missing-only data</button>
        <button className="min-h-11 rounded-md border border-border-strong bg-surface-2 px-3 text-sm" type="button" onClick={() => setDataset("default")}>Show full data</button>
      </div>
      <p aria-label="Chart viewport">Viewport: {compact ? "compact" : "wide"}</p>
      <output aria-label="Selected chart point">{selection}</output>
      <section aria-label="Period trend chart" className="min-w-0">
        <h2>Period trend</h2>
        <PeriodTrendChart
          compact={compact}
          ariaLabel={text(labels.trend)}
          timeZone={timeZone}
          label={text(labels.current)}
          grouping="day"
          mark="line"
          unit={unit}
          current={trendBuckets.current.map(formatDetail)}
          previous={trendBuckets.previous.length === 0 ? undefined : { label: text(labels.previous), points: trendBuckets.previous.map(formatDetail) }}
          onSelect={(point, period) => setSelection(
            period + " · " + point.at + " · " + (point.value === null ? "Not recorded" : formatMetric(point.value, unit)) + (point.detail ? " · " + point.detail : ""),
          )}
        />
      </section>
      <section aria-label="Hourly histogram chart" className="min-w-0">
        <h2>Hourly histogram</h2>
        <HourlyHistogram
          compact={compact}
          ariaLabel={text(labels.histogram)}
          timeZone={timeZone}
          unit={unit}
          buckets={hourlyBuckets}
          onSelect={(bucket) => setSelection(
            String(bucket.hour).padStart(2, "0") + ":00 · " + (bucket.value === null ? "Not recorded" : formatMetric(bucket.value, unit)) + (bucket.detail ? " · " + bucket.detail : ""),
          )}
        />
      </section>
    </div>
  </PluginScreenFrame>;
}
`;

export const reportingChartsPluginPackage = Effect.fn(function* () {
	const pluginSlug = `reporting-charts-${yield* randomUuid}`;
	const packageId = testPluginPackageId();
	const manifest = testPluginManifest({
		packageId,
		pluginSlug,
		clientDefinition: {
			entities: {},
			homeView: null,
			notFoundPage: "home",
			routes: { "/": "home" },
			apiVersion: CLIENT_API_VERSION,
			exports: {
				home: {
					kind: "page",
					entry: "client/home.tsx",
					settingsSchema: { fields: {} },
					automaticEntityPresentations: false,
				},
			},
		},
	});
	return {
		manifest,
		catalogs: fixtureCatalogs(manifest, Object.values(labels)),
		files: encodePluginSourceFiles({ "client/home.tsx": homeSource(packageId) }),
	};
});
