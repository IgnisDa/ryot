import { useBackgroundSubmission, useFormatters } from "@ryot-app/plugin-client-sdk/react";
import { type RefObject, useState } from "react";

import type { MeasurementSummary } from "../../shared/measurement-recipes";
import { catalogMessage } from "../../shared/messages.generated";
import { useFitnessMessages } from "../messages";
import { selectPinnedMetrics } from "./model";
import { logReadingsSubmission, readingFailureMessage } from "./mutations";
import { MeasurementDialog } from "./reading-composer";

export function LogMeasurementDialog(props: {
	readonly onClose: () => void;
	readonly metrics: readonly MeasurementSummary[];
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useFitnessMessages();
	const formatters = useFormatters();
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
			pending={log.isSending}
			triggerRef={props.triggerRef}
			label={text("client.measurements.log")}
			submitLabel={text("common.action.save")}
			pendingLabel={text("common.status.saving")}
			closeLabel={text("client.measurements.log-close")}
			errorMessage={readingFailureMessage(text, log.error, "log")}
			onSubmit={(entry) =>
				log.submit(
					{
						entry,
						label: catalogMessage("client.measurements.logged", {
							names: formatters
								.list({ type: "unit", style: "long" })
								.format(
									entry.values.map(
										({ metricId }) =>
											metrics.find(({ id }) => id === metricId)?.name ??
											text("client.measurements.logged-fallback"),
									),
								),
						}),
					},
					{ onAccepted: onClose },
				)
			}
		/>
	);
}
