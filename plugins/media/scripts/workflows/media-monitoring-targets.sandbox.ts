import { defineActivity } from "@ryot/sandbox-sdk/activity";
import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	buildMediaMonitoringSweepQuery,
	mediaMonitoringRows,
	queryPageHasMore,
} from "../../media-monitoring";
import {
	MediaMonitoringTargetsActivityInput,
	MediaMonitoringTargetsActivityOutput,
} from "../../workflows/schemas";

export const manifest = defineManifest({
	kind: "activity",
	name: "List media monitoring targets",
	capabilities: ["executeQueryEngine"],
	slug: "activity.media-monitoring-targets",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
});

export default defineActivity({
	manifest,
	input: MediaMonitoringTargetsActivityInput,
	output: MediaMonitoringTargetsActivityOutput,
	run: (input, host) =>
		host.executeQueryEngine(buildMediaMonitoringSweepQuery(input.page, input.limit)).pipe(
			Effect.map((response) => ({
				hasMore: queryPageHasMore(response),
				items: mediaMonitoringRows(response).map(
					({ entityId, externalId, providerId, entitySchemaSlug }) => ({
						entityId,
						externalId,
						providerId,
						entitySchemaSlug,
					}),
				),
			})),
		),
});
