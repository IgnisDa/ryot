import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { ChipButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";

import {
	MediaMonitoringDisableInput,
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
} from "../../shared/media-monitoring-operations";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

const toggleMonitoring = createRyotMutation<
	{ readonly entityId: string; readonly monitored: boolean },
	void
>(({ client, input: { entityId, monitored } }) =>
	Effect.gen(function* () {
		const { results } = yield* client.operations.invoke({
			packageId: PLUGIN_PACKAGE_ID,
			output: MediaMonitoringOutput,
			input: { entityIds: [entityId] },
			slug: monitored ? "media-monitoring-enable" : "media-monitoring-disable",
			inputSchema: monitored ? MediaMonitoringEnableInput : MediaMonitoringDisableInput,
		});
		const result = results[0];
		if (
			results.length !== 1 ||
			result?.entityId !== entityId ||
			result.status !== "found" ||
			result.isMediaMonitored !== monitored
		) {
			return yield* new RyotClientError("malformed-result");
		}
		return undefined;
	}),
);

export function MediaMonitoringControl(props: {
	readonly entityId: string;
	readonly monitored: boolean;
}) {
	const mutation = useRyotMutation(toggleMonitoring);
	return (
		<>
			<ChipButton
				pressed={props.monitored}
				disabled={mutation.isPending}
				title="Keep provider details up to date"
				icon={<AppIcon size={13} name="refresh-cw" />}
				onClick={() => mutation.mutate({ entityId: props.entityId, monitored: !props.monitored })}
			>
				{props.monitored ? "Monitoring" : "Monitor"}
			</ChipButton>
			{mutation.error === null ? null : (
				<span role="alert" className="text-xs text-danger">
					Unable to change monitoring. Try again.
				</span>
			)}
		</>
	);
}
