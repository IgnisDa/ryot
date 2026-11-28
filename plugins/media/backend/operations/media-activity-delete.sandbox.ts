import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, StaleBaselineError } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MediaActivityDeleteInput,
	MediaActivityEditOutput,
} from "../../shared/media-activity-operations";
import { catalogMessage } from "../../shared/messages.generated";
import { activityCombinations, deleteTargetChanges, loadEditTargets } from "./media-activity-edits";

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete media activity",
	slug: "operation.media-activity-delete",
});

export default defineOperation({
	manifest,
	output: MediaActivityEditOutput,
	input: MediaActivityDeleteInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const targets = yield* loadEditTargets(
				host,
				input.eventIds,
				activityCombinations,
				catalogMessage("rejection.record.activity-only-delete"),
			);
			if (targets.length === 0 && input.expected !== undefined) {
				return yield* new StaleBaselineError({ conflict: "event-not-found" });
			}
			const output = { count: targets.length };
			return targets.length === 0
				? { output }
				: {
						output,
						changes: deleteTargetChanges(
							targets.map(({ id }) => id),
							input.expected,
						),
					};
		}),
});
