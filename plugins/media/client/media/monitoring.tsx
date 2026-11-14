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
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

type MonitoringTarget = { readonly entityId: string };

const enableMonitoring = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	slug: "media-monitoring-enable",
	label: () => "Started monitoring",
	inputSchema: MediaMonitoringEnableInput,
	input: ({ input }: { readonly input: MonitoringTarget }) => ({ entityIds: [input.entityId] }),
});

const disableMonitoring = createRyotBackgroundSubmission({
	packageId: PLUGIN_PACKAGE_ID,
	slug: "media-monitoring-disable",
	label: () => "Stopped monitoring",
	inputSchema: MediaMonitoringDisableInput,
	input: ({ input }: { readonly input: MonitoringTarget }) => ({ entityIds: [input.entityId] }),
});

export function MediaMonitoringControl(props: {
	readonly entityId: string;
	readonly monitored: boolean;
}) {
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
				title="Keep provider details up to date"
				icon={<AppIcon size={13} name="refresh-cw" />}
				disabled={enable.isSending || disable.isSending}
				onClick={() => {
					setOptimistic(!monitored);
					(monitored ? disable : enable).submit({ entityId: props.entityId });
				}}
			>
				{monitored ? "Monitoring" : "Monitor"}
			</ChipButton>
			{optimistic !== null && rolledBack ? (
				<span role="alert" className="text-xs text-danger">
					Unable to change monitoring. Try again.
				</span>
			) : null}
		</>
	);
}
