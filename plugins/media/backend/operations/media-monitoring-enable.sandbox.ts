import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineOperation } from "@ryot-app/sandbox-sdk/operation";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/sandbox-sdk/ryotql";

import { MediaMonitoringEnableInput, MediaMonitoringOutput } from "../contracts/operations";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	name: "Enable media monitoring",
	slug: "operation.media-monitoring-enable",
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

export default defineOperation({
	manifest,
	output: MediaMonitoringOutput,
	input: MediaMonitoringEnableInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [targets, mediaLibrary] = yield* Effect.all([
				queryMediaMonitoringTargets(input.entityIds, host.executeRyotql),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe()),
			]);
			if (targets.length > 0) {
				yield* host.changeUserRelationships([
					{
						deletes: [],
						creates: targets.flatMap(({ entityId }) => [
							{
								properties: {},
								sourceEntityId: entityId,
								targetEntityId: mediaLibrary.entityId,
								relationshipSchemaSlug: "in-media-library",
							},
							{
								properties: {},
								sourceEntityId: entityId,
								targetEntityId: mediaLibrary.entityId,
								relationshipSchemaSlug: "media-monitoring",
							},
						]),
					},
				]);
			}
			return { results: alignedMediaMonitoringResults(input.entityIds, targets, () => true) };
		}),
});
