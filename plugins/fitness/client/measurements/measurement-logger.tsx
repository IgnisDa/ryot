import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
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
