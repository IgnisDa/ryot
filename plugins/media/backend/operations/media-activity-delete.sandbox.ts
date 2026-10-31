import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";

import {
	MediaActivityDeleteInput,
	MediaActivityLogOutput,
} from "../../shared/media-activity-operations";
import {
	activityCombinations,
	loadEditTargets,
	MEDIA_EDIT_CHUNK_SIZE,
	rejectAnyHostFailure,
	writePrecondition,
} from "./media-activity-edits";

const chunked = (ids: readonly string[]) =>
	Array.from({ length: Math.ceil(ids.length / MEDIA_EDIT_CHUNK_SIZE) }, (_, index) =>
		ids.slice(index * MEDIA_EDIT_CHUNK_SIZE, (index + 1) * MEDIA_EDIT_CHUNK_SIZE),
	);

export const manifest = defineManifest({
	kind: "operation",
	name: "Delete media activity",
	slug: "operation.media-activity-delete",
});

export default defineOperation({
	manifest,
	output: MediaActivityLogOutput,
	input: MediaActivityDeleteInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const chunks = chunked(input.eventIds);
			for (const chunk of chunks) {
				yield* loadEditTargets(
					host,
					chunk,
					activityCombinations,
					"Only activity records can be deleted here.",
				);
			}
			const [onlyId] = input.eventIds;
			const expected =
				input.expected === undefined || onlyId === undefined
					? {}
					: { expected: { [onlyId]: writePrecondition(input.expected) } };
			let count = 0;
			for (const [index, chunk] of chunks.entries()) {
				const written = yield* host
					.deleteEvents(chunk, {
						...expected,
						submittedAt: input.submittedAt,
						idempotencyKey: `${input.submissionId}:${index}`,
					})
					.pipe(
						Effect.map((result) => ({ ...result, failed: false })),
						Effect.catch((error) =>
							index === 0
								? rejectAnyHostFailure(error)
								: Effect.succeed({ count: 0, failed: true }),
						),
					);
				if (written.failed) {
					return { count, status: "incomplete" as const };
				}
				count += written.count;
			}
			return { count, status: "saved" as const };
		}),
});
