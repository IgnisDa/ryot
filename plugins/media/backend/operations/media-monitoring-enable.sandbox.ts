import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	MediaMonitoringEnableInput,
	MediaMonitoringOutput,
} from "../../shared/media-monitoring-operations";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	name: "Enable media monitoring",
	slug: "operation.media-monitoring-enable",
});

export default defineOperation({
	manifest,
	output: MediaMonitoringOutput,
	input: MediaMonitoringEnableInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [targets, mediaLibrary] = yield* Effect.all([
				queryMediaMonitoringTargets(input.entityIds, host.executeRyotql),
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe({ kind: "self" })),
			]);
			if (targets.length > 0) {
				yield* host.changeUserRelationships([
					{
						deletes: [],
						creates: targets.flatMap(({ entityId }) => [
							{
								properties: {},
								propertiesMode: "merge",
								sourceEntityId: entityId,
								targetEntityId: mediaLibrary.entityId,
								relationshipSchemaSlug: "in-media-library",
							},
							{
								properties: {},
								propertiesMode: "merge",
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
