import { CLIENT_API_VERSION } from "@ryot-app/plugin-client-contract";
import { randomUuid } from "@ryot-app/testing/random";
import { Effect } from "effect";

import { encodePluginSourceFiles, testPluginManifest, testPluginPackageId } from "./test-plugin";

const homeSource = `
import { HourlyHistogram, PeriodTrendChart } from "@ryot-app/plugin-ui-sdk/charts";
import { TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { PluginScreenFrame } from "@ryot-app/plugin-client-sdk/screen";
import { useState } from "react";

const baseTrend = {
  current: [
    { at: "2026-09-01", value: 0, detail: "Recorded" },
    { at: "2026-09-02", value: 4, detail: "Estimated" },
    { at: "2026-09-03", value: null, detail: "Missing" },
  ],
  previous: [
    { at: "2026-08-01", value: 2 },
    { at: "2026-08-02", value: 1 },
    { at: "2026-08-03", value: 3 },
  ],
};

const trendFor = (dataset: "default" | "empty" | "single" | "zero" | "missing-only") => {
  if (dataset === "empty") return { current: [], previous: [] };
  if (dataset === "single") return { current: [{ at: "2026-09-01", value: 4, detail: "Estimated" }], previous: [] };
  if (dataset === "zero") {
    return { current: [{ at: "2026-09-01", value: 0 }], previous: [{ at: "2026-08-01", value: 0 }] };
  }
  if (dataset === "missing-only") {
    return {
      current: [{ at: "2026-09-01", value: null, detail: "Missing" }],
      previous: [{ at: "2026-08-01", value: null, detail: "Missing" }],
    };
  }
  return baseTrend;
};

const formatValue = (value: number) => String(value) + " entries";

const hoursFor = (dataset: "default" | "empty" | "single" | "zero" | "missing-only") => {
  if (dataset === "empty") return [];
  return Array.from({ length: 24 }, (_, hour) => {
    if (dataset === "single") {
      return { hour, value: hour === 8 ? 4 : null, detail: hour === 8 ? "Estimated" : "Missing" };
    }
    if (dataset === "zero") return { hour, value: 0, detail: "Recorded" };
    if (dataset === "missing-only") return { hour, value: null, detail: "Missing" };
    return {
      hour,
      value: hour === 8 ? 4 : hour === 18 ? null : 0,
      detail: hour === 8 ? "Recorded" : hour === 18 ? "Missing" : "Recorded",
    };
  });
};

export default function Home() {
  const { compact } = useRyotViewport();
  const [dataset, setDataset] = useState<"default" | "empty" | "single" | "zero" | "missing-only">("default");
  const [selection, setSelection] = useState("Not selected");
  const timeZone = TimeZone.make("America/New_York");
  const trendBuckets = trendFor(dataset);
  const hourlyBuckets = hoursFor(dataset);

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
          ariaLabel="Period trend"
          timeZone={timeZone}
          label="Current period · Sep 1–3, 2026"
          formatValue={formatValue}
          current={trendBuckets.current}
          previous={trendBuckets.previous.length === 0 ? undefined : { label: "Previous period · Aug 1–3, 2026", points: trendBuckets.previous }}
          onSelect={(point, period) => setSelection(
            period + " · " + point.at + " · " + (point.value === null ? "Not recorded" : formatValue(point.value)) + (point.detail ? " · " + point.detail : ""),
          )}
        />
      </section>
      <section aria-label="Hourly histogram chart" className="min-w-0">
        <h2>Hourly histogram</h2>
        <HourlyHistogram
          compact={compact}
          ariaLabel="Hourly histogram"
          timeZone={timeZone}
          periodLabel="Local-hour observations · Sep 1–3, 2026"
          formatValue={formatValue}
          buckets={hourlyBuckets}
          onSelect={(bucket) => setSelection(
            String(bucket.hour).padStart(2, "0") + ":00 · " + (bucket.value === null ? "Not recorded" : formatValue(bucket.value)) + (bucket.detail ? " · " + bucket.detail : ""),
          )}
        />
      </section>
    </div>
  </PluginScreenFrame>;
}
`;

export const reportingChartsPluginPackage = Effect.fn(function* () {
	const pluginSlug = `reporting-charts-${yield* randomUuid}`;
	return {
		files: encodePluginSourceFiles({ "client/home.tsx": homeSource }),
		manifest: testPluginManifest({
			pluginSlug,
			packageId: testPluginPackageId(),
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
		}),
	};
});
