import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotMutation, useRyotMutation } from "@ryot-app/plugin-client-sdk/react";
import { Row, Switch } from "@ryot-app/plugin-ui-sdk";

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

export function MediaMonitoringRow(props: {
	readonly entityId: string;
	readonly monitored: boolean;
}) {
	const mutation = useRyotMutation(toggleMonitoring);
	return (
		<Row
			title="Monitoring"
			description={
				mutation.error === null ? (
					"Keep provider details up to date"
				) : (
					<span role="alert">Unable to change monitoring. Try again.</span>
				)
			}
			trailing={
				<Switch
					checked={props.monitored}
					disabled={mutation.isPending}
					label="Toggle media monitoring"
					onChange={(monitored) => mutation.mutate({ monitored, entityId: props.entityId })}
				/>
			}
		/>
	);
}
