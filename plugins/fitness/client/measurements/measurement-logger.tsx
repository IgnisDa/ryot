import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { type RefObject, useRef, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { AddMetricDialog } from "./add-metric";
import { LogMeasurementDialog } from "./log-measurement-dialog";
import { summaryQuery } from "./queries";

export type MeasurementDialogState = {
	readonly kind: "log" | "add-metric";
	readonly metrics: readonly MeasurementSummary[];
};

export const useMeasurementLogger = () => {
	const [dialog, setDialog] = useState<MeasurementDialogState>();
	const trigger = useRef<null | HTMLButtonElement>(null);
	const result = useRyotQuery(summaryQuery, { range: "All" });
	const log = () => {
		if (result.data !== undefined) {
			setDialog({ metrics: result.data, kind: result.data.length === 0 ? "add-metric" : "log" });
		}
	};
	return {
		log,
		dialog,
		trigger,
		error: result.isError,
		retry: result.refetch,
		close: () => setDialog(undefined),
		loading: result.data === undefined && !result.isError,
		unavailable: result.data === undefined || result.isFetching || result.isError,
		setTrigger: (node: null | HTMLButtonElement) => {
			trigger.current = node;
		},
	};
};

export function MeasurementDialogs(props: {
	readonly onClose: () => void;
	readonly dialog: undefined | MeasurementDialogState;
	readonly trigger: RefObject<null | HTMLButtonElement>;
}) {
	if (props.dialog === undefined) {
		return null;
	}
	return props.dialog.kind === "add-metric" ? (
		<AddMetricDialog
			onClose={props.onClose}
			triggerRef={props.trigger}
			metrics={props.dialog.metrics}
		/>
	) : (
		<LogMeasurementDialog
			onClose={props.onClose}
			triggerRef={props.trigger}
			metrics={props.dialog.metrics}
		/>
	);
}
