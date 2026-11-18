import { existingEntity } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";
import { EntityId } from "@ryot-app/plugin-kit/schema";

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
				executeRyotqlRecipe(host.executeRyotql, userMediaLibraryRecipe({ kind: "self" }), {}),
			]);
			const library = existingEntity(EntityId.make(mediaLibrary.entityId));
			const output = {
				results: alignedMediaMonitoringResults(input.entityIds, targets, () => true),
			};
			if (targets.length === 0) {
				return { output };
			}
			return {
				output,
				changes: {
					relationships: {
						upserts: targets.flatMap(({ entityId }) =>
							["in-media-library", "media-monitoring"].map((relationshipSchemaSlug) => ({
								properties: {},
								target: library,
								relationshipSchemaSlug,
								propertiesMode: "merge" as const,
								source: existingEntity(EntityId.make(entityId)),
							})),
						),
					},
				},
			};
		}),
});
