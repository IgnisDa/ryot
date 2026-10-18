import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { Sparkline } from "@ryot-app/plugin-ui-sdk/charts";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { MeasurementDialogs, useMeasurementLogger } from "../measurements/measurement-logger";
import { buildMetricRows, selectPinnedMetrics } from "../measurements/model";
import { seriesQuery, summaryQuery } from "../measurements/queries";
import { loggedPhrase, measurementValue } from "./model";
import { HomeCard, QueryBody, SavedViewLink } from "./section";

export function LogMeasurementButton(props: {
	readonly label: string;
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

export function MeasurementsCard(props: { readonly now: Date; readonly timeZone: string }) {
	const { now, timeZone } = props;
	const logger = useMeasurementLogger();
	const summaries = useRyotQuery(summaryQuery, { range: "All" });
	return (
		<HomeCard
			label="Pinned measurements"
			title="Pinned measurements"
			link={<SavedViewLink slug="all-measurements">All</SavedViewLink>}
		>
			<QueryBody result={summaries} noun="measurements">
				{(data) => {
					const pinned = selectPinnedMetrics(data);
					return pinned.length === 0 ? (
						<p className="text-[13px] text-text-muted">
							{data.length === 0
								? "Add a metric to start tracking weight, body fat, or anything else."
								: "Star up to 3 metrics on All Measurements to pin them here."}
						</p>
					) : (
						<PinnedTiles now={now} pinned={pinned} summaries={data} timeZone={timeZone} />
					);
				}}
			</QueryBody>
			<LogMeasurementButton measurement={logger} label="Log measurement" />
		</HomeCard>
	);
}

function PinnedTiles(props: {
	readonly now: Date;
	readonly timeZone: string;
	readonly pinned: readonly MeasurementSummary[];
	readonly summaries: readonly MeasurementSummary[];
}) {
	const { now, pinned, timeZone } = props;
	const series = useRyotQuery(seriesQuery, {
		range: "3M",
		metricIds: pinned.map(({ id }) => id),
		firstReadings: props.summaries.map(({ firstAt }) => ({ firstAt })),
	});
	return (
		<div className="flex flex-col gap-2">
			{buildMetricRows(pinned, series.data ?? []).map(({ trend, summary }) => (
				<div
					key={summary.id}
					className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5"
				>
					<div className="flex min-w-0 flex-col">
						<span className="truncate text-[13px] text-text-muted">{summary.name}</span>
						<span className="text-[20px] leading-tight font-semibold text-text tabular-nums">
							{measurementValue(summary.latestValue, summary.unit)}
						</span>
						<span className="text-[12px] text-text-muted">
							{loggedPhrase(summary.latestAt, now, timeZone)}
						</span>
					</div>
					{series.data === undefined ? null : (
						<Sparkline tone="accent" points={trend} ariaLabel={`${summary.name} trend`} />
					)}
				</div>
			))}
		</div>
	);
}
