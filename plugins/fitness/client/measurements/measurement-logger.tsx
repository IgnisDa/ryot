import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useRef, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { AddMetricDialog } from "./add-metric";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { summaryQuery } from "./queries";

const RANGE_START = "1970-01-01T00:00:00.000Z";

export function MeasurementLogger(props: { readonly disabled?: boolean }) {
	const [addingMetric, setAddingMetric] = useState(false);
	const [logging, setLogging] = useState<readonly MeasurementSummary[] | null>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const result = useRyotQuery(summaryQuery, { rangeStart: RANGE_START });
	const queryUnavailable = result.data === undefined || result.isFetching || result.isError;
	const log = () => {
		if (result.data === undefined) {
			return;
		}
		if (result.data.length === 0) {
			setAddingMetric(true);
			return;
		}
		setLogging(result.data);
	};
	return (
		<div className="flex flex-wrap items-center gap-2.5 font-ui">
			<div className="flex flex-wrap items-center gap-2.5">
				<Button
					onClick={log}
					ref={triggerRef}
					className="min-h-9 px-3.5 py-1.5"
					disabled={props.disabled === true || queryUnavailable}
				>
					Log measurement
				</Button>
				<p className="text-sm text-text-muted">Measurements save separately from this workout.</p>
			</div>
			{result.isError ? (
				<div className="flex flex-wrap items-center gap-2.5">
					<StatusMessage tone="error">Your measurements couldn&apos;t be loaded.</StatusMessage>
					<Button variant="secondary" onClick={result.refetch} disabled={props.disabled}>
						Try again
					</Button>
				</div>
			) : null}
			{result.data === undefined && !result.isError ? (
				<StatusMessage tone="pending">Loading measurements…</StatusMessage>
			) : null}
			{addingMetric && result.data !== undefined ? (
				<AddMetricDialog
					metrics={result.data}
					triggerRef={triggerRef}
					onClose={() => setAddingMetric(false)}
				/>
			) : null}
			{logging !== null ? (
				<LogMeasurementDialog
					metrics={logging}
					triggerRef={triggerRef}
					onClose={() => setLogging(null)}
				/>
			) : null}
		</div>
	);
}
