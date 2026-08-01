import { defineManifest, defineScript } from "@ryot/sandbox-sdk/driver";
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
	kind: "script",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	slug: "media-monitoring-targets",
	capabilities: ["executeQueryEngine"],
	name: "List media monitoring targets",
});

export default defineScript({
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
