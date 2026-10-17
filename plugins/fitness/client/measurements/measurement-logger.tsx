import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { useMemo, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { AddMetricDialog } from "./add-metric";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { summaryQuery } from "./queries";

const RANGE_START = "1970-01-01T00:00:00.000Z";

type MeasurementDialog = {
	readonly kind: "add-metric" | "log";
	readonly metrics: readonly MeasurementSummary[];
};

export const useMeasurementLogger = () => {
	const [dialog, setDialog] = useState<MeasurementDialog>();
	const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
	const result = useRyotQuery(summaryQuery, { rangeStart: RANGE_START });
	const log = () => {
		if (result.data !== undefined) {
			setDialog({ metrics: result.data, kind: result.data.length === 0 ? "add-metric" : "log" });
		}
	};
	return {
		log,
		dialog,
		trigger,
		setTrigger,
		error: result.isError,
		retry: result.refetch,
		close: () => setDialog(undefined),
		loading: result.data === undefined && !result.isError,
		unavailable: result.data === undefined || result.isFetching || result.isError,
	};
};

export function MeasurementDialogs(props: {
	readonly onClose: () => void;
	readonly trigger: HTMLButtonElement | null;
	readonly dialog: MeasurementDialog | undefined;
}) {
	const focusTarget = useMemo(() => ({ current: props.trigger }), [props.trigger]);
	if (props.dialog === undefined) {
		return null;
	}
	return props.dialog.kind === "add-metric" ? (
		<AddMetricDialog
			onClose={props.onClose}
			triggerRef={focusTarget}
			metrics={props.dialog.metrics}
		/>
	) : (
		<LogMeasurementDialog
			onClose={props.onClose}
			triggerRef={focusTarget}
			metrics={props.dialog.metrics}
		/>
	);
}

export function MeasurementLogger(props: { readonly disabled?: boolean }) {
	const {
		log: loggerLog,
		error: loggerError,
		retry: loggerRetry,
		close: loggerClose,
		dialog: loggerDialog,
		trigger: loggerTrigger,
		loading: loggerLoading,
		setTrigger: loggerSetTrigger,
		unavailable: loggerUnavailable,
	} = useMeasurementLogger();
	return (
		<div className="flex flex-wrap items-center gap-2.5 font-ui">
			<div className="flex flex-wrap items-center gap-2.5">
				<Button
					onClick={loggerLog}
					ref={loggerSetTrigger}
					className="min-h-9 px-3.5 py-1.5"
					disabled={props.disabled === true || loggerUnavailable}
				>
					Log measurement
				</Button>
				<p className="text-sm text-text-muted">Measurements save separately from this workout.</p>
			</div>
			{loggerError ? (
				<div className="flex flex-wrap items-center gap-2.5">
					<StatusMessage tone="error">Your measurements couldn&apos;t be loaded.</StatusMessage>
					<Button variant="secondary" onClick={loggerRetry} disabled={props.disabled}>
						Try again
					</Button>
				</div>
			) : null}
			{loggerLoading ? <StatusMessage tone="pending">Loading measurements…</StatusMessage> : null}
			<MeasurementDialogs dialog={loggerDialog} onClose={loggerClose} trigger={loggerTrigger} />
		</div>
	);
}
