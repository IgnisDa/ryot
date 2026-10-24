import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { EventStreamInputRepairInput } from "@ryot-app/plugin-backend-sdk/event-streams";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import { advanceHistoryCorrection } from "./automations/history-correction";
import {
	historyCorrectionReference,
	historyCorrectionWork,
	isHistoryCorrectionConflict,
	startHistoryCorrection,
} from "./contracts/history-correction";

export const manifest = defineManifest({
	kind: "script",
	name: "Repair media consumption inputs",
	slug: "script.media-consumption-input-repair",
});

export default defineScript({
	manifest,
	output: Schema.Null,
	input: EventStreamInputRepairInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const { entityId: libraryId } = yield* executeRyotqlRecipe(
				host.executeRyotql,
				userMediaLibraryRecipe({ kind: "self" }),
			);
			const request = startHistoryCorrection({
				force: true,
				liveSourceIds: [],
				entityId: input.entityId,
				requestKey: input.requestKey,
				workKey: `${input.entityId}:input-repair:${input.requestKey}`,
			});
			const result = yield* advanceHistoryCorrection(host, request.input, libraryId).pipe(
				Effect.retry({
					times: 5,
					while: (error) => isHistoryCorrectionConflict("data" in error ? error : {}),
				}),
			);
			if (result.pending) {
				yield* host.requestUserWork(
					historyCorrectionWork({
						...request.input,
						force: false,
						conflictAttempt: 0,
						workKey: result.nextKey,
						conflictBase: result.nextKey,
					}),
					historyCorrectionReference,
				);
			}
			return null;
		}),
});
