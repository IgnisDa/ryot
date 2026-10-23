import { useRyotSubmission } from "@ryot-app/plugin-client-sdk/react";
import { type RefObject, useEffect, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { selectPinnedMetrics } from "./model";
import { logReadingsMutation, readingFailureMessage } from "./mutations";
import { MeasurementDialog } from "./reading-composer";

export function LogMeasurementDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { metrics, onClose } = props;
	const log = useRyotSubmission(logReadingsMutation, {
		isComplete: (result) => result.status === "saved",
	});
	useEffect(() => {
		if (log.data?.status === "saved") {
			onClose();
		}
	}, [log.data, onClose]);
	const [initial] = useState(() => {
		const pinned = selectPinnedMetrics(metrics);
		return {
			comment: null,
			occurredAt: new Date().toISOString(),
			values: (pinned.length === 0 ? metrics.slice(0, 1) : pinned).map(({ id }) => ({
				value: null,
				metricId: id,
			})),
		};
	});
	return (
		<MeasurementDialog
			initial={initial}
			metrics={metrics}
			onClose={onClose}
			submitLabel="Save"
			onRetry={log.retry}
			onChange={log.reset}
			onSubmit={log.submit}
			pendingLabel="Saving…"
			label="Log measurement"
			pending={log.isPending}
			triggerRef={props.triggerRef}
			retained={log.status === "retained"}
			errorMessage={
				log.status === "retained"
					? "Some readings may already be saved. Retry the same submission to finish without duplicates. Cancel closes this form but does not undo saved readings."
					: readingFailureMessage(log.error, "log")
			}
		/>
	);
}
