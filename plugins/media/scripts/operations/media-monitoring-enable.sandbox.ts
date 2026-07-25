import { defineManifest } from "@ryot/sandbox-sdk/driver";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineOperation } from "@ryot/sandbox-sdk/operation";

import { buildUserLibraryDocument, decodeUserLibraryId } from "../../media-monitoring-ryotql";
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
			const [targets, libraryResponse] = yield* Effect.all([
				queryMediaMonitoringTargets(input.entityIds, host.executeRyotql),
				host.executeRyotql(buildUserLibraryDocument()),
			]);
			const libraryEntityId = decodeUserLibraryId(libraryResponse);
			if (!libraryEntityId) {
				return yield* Effect.fail(new Error("Library entity not found for user"));
			}
			if (targets.length > 0) {
				yield* host.changeUserRelationships([
					{
						deletes: [],
						creates: targets.flatMap(({ entityId }) => [
							{
								properties: {},
								sourceEntityId: entityId,
								targetEntityId: libraryEntityId,
								relationshipSchemaSlug: "in-library",
							},
							{
								properties: {},
								sourceEntityId: entityId,
								targetEntityId: libraryEntityId,
								relationshipSchemaSlug: "media-monitoring",
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
