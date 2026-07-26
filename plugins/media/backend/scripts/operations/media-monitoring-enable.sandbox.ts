import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";
import { executeRyotqlRecipe, userLibraryRecipe } from "@ryot/sandbox-sdk/ryotql";

import { MediaMonitoringEnableInput, MediaMonitoringOutput } from "../../operations/schemas";
import {
	alignedMediaMonitoringResults,
	queryMediaMonitoringTargets,
} from "./media-monitoring-shared";

export const manifest = defineManifest({
	kind: "operation",
	name: "Enable media monitoring",
	slug: "operation.media-monitoring-enable",
	requiredPluginConfigKeys: [],
	requiredSystemConfigKeys: [],
	capabilities: ["executeRyotql", "changeUserRelationships"],
});

export default defineOperation({
	manifest,
	input: MediaMonitoringEnableInput,
	output: MediaMonitoringOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const [targets, library] = yield* Effect.all([
				queryMediaMonitoringTargets(input.entityIds, host.executeRyotql),
				executeRyotqlRecipe(host.executeRyotql, userLibraryRecipe()),
			]);
			if (targets.length > 0) {
				yield* host.changeUserRelationships([
					{
						deletes: [],
						creates: targets.flatMap(({ entityId }) => [
							{
								properties: {},
								sourceEntityId: entityId,
								relationshipSchemaSlug: "in-library",
								targetEntityId: library.entityId,
							},
							{
								properties: {},
								sourceEntityId: entityId,
								relationshipSchemaSlug: "media-monitoring",
								targetEntityId: library.entityId,
							},
						]),
					},
				]);
			}
			return {
				results: alignedMediaMonitoringResults(input.entityIds, targets, () => true),
			};
		}),
});
