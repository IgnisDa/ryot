import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { executeRyotqlRecipe, userMediaLibraryRecipe } from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	historyCorrectionReference,
	HistoryCorrectionRequest,
} from "../contracts/history-correction";
import { advanceHistoryCorrection } from "./history-correction";

export const manifest = defineManifest({
	kind: "script",
	name: "Correct media history",
	slug: "media-history-correction",
});

const stale = (error: { readonly data?: unknown }) => {
	const reason = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.String }))(error.data);
	return (
		reason._tag === "Some" &&
		["entity-stale", "event-stale", "event-not-found", "mutation-conflict"].includes(
			reason.value.code,
		)
	);
};

export default defineScript({
	manifest,
	output: Schema.Null,
	input: HistoryCorrectionRequest,
	run: (input, host) =>
		Effect.gen(function* () {
			const { entityId: libraryId } = yield* executeRyotqlRecipe(
				host.executeRyotql,
				userMediaLibraryRecipe({ kind: "self" }),
			);
			let nextKey = input.workKey;
			let conflictAttempt = input.conflictAttempt;
			for (let step = 0; step < 8; step += 1) {
				const result = yield* advanceHistoryCorrection(host, input, libraryId).pipe(
					Effect.retry({ times: 5, while: (error) => stale("data" in error ? error : {}) }),
					Effect.catchIf(
						(error) => stale("data" in error ? error : {}),
						() => Effect.succeed(null),
					),
				);
				if (result === null) {
					conflictAttempt += 1;
					nextKey = `${input.entityId}:${input.requestKey}:conflict:${conflictAttempt}`;
					break;
				}
				if (!result.pending) {
					return null;
				}
				nextKey = result.nextKey;
			}
			yield* host.requestUserWork(
				{
					key: nextKey,
					scope: input.entityId,
					input: { ...input, force: false, conflictAttempt, workKey: nextKey },
				},
				historyCorrectionReference,
			);
			return null;
		}),
});
