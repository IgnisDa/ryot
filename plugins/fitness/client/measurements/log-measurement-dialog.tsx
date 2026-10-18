import { useBackgroundSubmission } from "@ryot-app/plugin-client-sdk/react";
import { type RefObject, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { selectPinnedMetrics } from "./model";
import { logReadingsSubmission, readingFailureMessage } from "./mutations";
import { MeasurementDialog } from "./reading-composer";

export function LogMeasurementDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { metrics, onClose } = props;
	const log = useBackgroundSubmission(logReadingsSubmission);
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
			pendingLabel="Saving…"
			label="Log measurement"
			pending={log.isSending}
			triggerRef={props.triggerRef}
			errorMessage={readingFailureMessage(log.error, "log")}
			onSubmit={(entry) =>
				log.submit(
					{
						entry,
						label: `Logged ${entry.values
							.map(
								({ metricId }) => metrics.find(({ id }) => id === metricId)?.name ?? "measurement",
							)
							.join(", ")}`,
					},
					{ onAccepted: onClose },
				)
			}
		/>
	);
}
