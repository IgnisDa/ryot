import type { LocalMessage } from "@ryot-app/plugin-client-sdk";
import {
	createRyotBackgroundSubmission,
	useBackgroundSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import { ChipButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useState } from "react";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
} from "../../shared/media-monitoring-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { useMediaMessages } from "../messages";

type MonitoringTarget = { readonly entityId: string; readonly label: LocalMessage };

const enableMonitoring = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	slug: "media-monitoring-enable",
	inputSchema: MediaMonitoringEnableInput,
	label: (input: MonitoringTarget) => input.label,
	input: ({ input }: { readonly input: MonitoringTarget }) => ({ entityIds: [input.entityId] }),
});

const disableMonitoring = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	slug: "media-monitoring-disable",
	inputSchema: MediaMonitoringDisableInput,
	label: (input: MonitoringTarget) => input.label,
	input: ({ input }: { readonly input: MonitoringTarget }) => ({ entityIds: [input.entityId] }),
});

export function MediaMonitoringControl(props: {
	readonly entityId: string;
	readonly monitored: boolean;
}) {
	const text = useMediaMessages();
	const enable = useBackgroundSubmission(enableMonitoring);
	const disable = useBackgroundSubmission(disableMonitoring);
	const [optimistic, setOptimistic] = useState<null | boolean>(null);
	const latest = optimistic === false ? disable : enable;
	const rolledBack = latest.last?.status === "failed" || latest.error !== null;
	if (optimistic !== null && optimistic === props.monitored) {
		setOptimistic(null);
	}
	const monitored = optimistic === null || rolledBack ? props.monitored : optimistic;
	return (
		<>
			<ChipButton
				pressed={monitored}
				title={text("monitoring.title")}
				icon={<AppIcon size={13} name="refresh-cw" />}
				disabled={enable.isSending || disable.isSending}
				onClick={() => {
					setOptimistic(!monitored);
					(monitored ? disable : enable).submit({
						entityId: props.entityId,
						label: catalogMessage(monitored ? "monitoring.stopped" : "monitoring.started"),
					});
				}}
			>
				{monitored ? text("monitoring.on") : text("monitoring.off")}
			</ChipButton>
			{optimistic !== null && rolledBack ? (
				<span role="alert" className="text-xs text-danger">
					{text("monitoring.failed")}
				</span>
			) : null}
		</>
	);
}
