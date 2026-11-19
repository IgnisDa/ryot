import type { TimeZone } from "@ryot-app/plugin-client-sdk/plugin";
import type { Text } from "@ryot-app/plugin-client-sdk/react";
import { useFormatters, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { Sparkline } from "@ryot-app/plugin-ui-sdk/charts";

import { buildMetricRows } from "../../shared/measurement-metrics";
import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { MeasurementDialogs, useMeasurementLogger } from "../measurements/measurement-logger";
import { selectPinnedMetrics } from "../measurements/model";
import { seriesQuery, summaryQuery } from "../measurements/queries";
import { useFitnessMessages } from "../messages";
import { loggedPhrase, measurementValue } from "./model";
import { HomeCard, QueryBody, SavedViewLink } from "./section";

export function LogMeasurementButton(props: {
	readonly label: Text;
	readonly measurement: ReturnType<typeof useMeasurementLogger>;
}) {
	const { log, setTrigger, unavailable } = props.measurement;
	return (
		<>
			<Button
				onClick={log}
				ref={setTrigger}
				variant="secondary"
				disabled={unavailable}
				className="self-start"
			>
				{props.label}
			</Button>
			<MeasurementDialogs
				dialog={props.measurement.dialog}
				onClose={props.measurement.close}
				trigger={props.measurement.trigger}
			/>
		</>
	);
}

export function MeasurementsCard(props: { readonly now: Date; readonly timeZone: TimeZone }) {
	const text = useFitnessMessages();
	const { now, timeZone } = props;
	const logger = useMeasurementLogger();
	const summaries = useRyotQuery(summaryQuery, { range: "All" });
	return (
		<HomeCard
			label={text("client.home.pinned-measurements")}
			title={text("client.home.pinned-measurements")}
			link={<SavedViewLink slug="all-measurements">{text("client.home.pinned-all")}</SavedViewLink>}
		>
			<QueryBody result={summaries} noun="measurements">
				{(data) => {
					const pinned = selectPinnedMetrics(data);
					return pinned.length === 0 ? (
						<p className="text-[13px] text-text-muted">
							{data.length === 0
								? text("client.home.pinned-empty")
								: text("client.home.pinned-none-pinned")}
						</p>
					) : (
						<PinnedTiles now={now} pinned={pinned} summaries={data} timeZone={timeZone} />
					);
				}}
			</QueryBody>
			<LogMeasurementButton measurement={logger} label={text("client.measurements.log")} />
		</HomeCard>
	);
}

function PinnedTiles(props: {
	readonly now: Date;
	readonly timeZone: TimeZone;
	readonly pinned: readonly MeasurementSummary[];
	readonly summaries: readonly MeasurementSummary[];
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
	const { now, pinned, timeZone } = props;
	const series = useRyotQuery(seriesQuery, {
		timeZone,
		range: "3M",
		metricIds: pinned.map(({ id }) => id),
		firstReadings: props.summaries.map(({ firstAt }) => ({ firstAt })),
	});
	const rows = new Map(
		(series.data === undefined
			? []
			: buildMetricRows(pinned, series.data.series, { timeZone, bucket: series.data.window.bucket })
		).map(({ trend, summary }) => [summary.id, trend]),
	);
	return (
		<div className="flex flex-col gap-2">
			{pinned.map((summary) => (
				<div
					key={summary.id}
					className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5"
				>
					<div className="flex min-w-0 flex-col">
						<span className="truncate text-[13px] text-text-muted">{summary.name}</span>
						<span className="text-[20px] leading-tight font-semibold text-text tabular-nums">
							{measurementValue(formatters, text, summary.latestValue, summary.unit)}
						</span>
						<span className="text-[12px] text-text-muted">
							{loggedPhrase(formatters, text, summary.latestAt, now, timeZone)}
						</span>
					</div>
					{rows.has(summary.id) ? (
						<Sparkline
							tone="accent"
							points={rows.get(summary.id) ?? []}
							ariaLabel={text("client.measurements.trend-label", { name: summary.name })}
						/>
					) : null}
				</div>
			))}
		</div>
	);
}
