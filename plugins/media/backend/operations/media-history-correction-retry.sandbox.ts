import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation, OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	entitySchemaPredicate,
	eq,
	executeRyotqlRecipe,
	literal,
	or,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import {
	MediaHistoryCorrectionRetryInput,
	MediaHistoryCorrectionRetryOutput,
} from "../../shared/history-correction-status";
import { mediaActivityEntitySchemaSlugs } from "../../shared/media-activity-fields";
import { historyCorrectionReference } from "../contracts/history-correction";

const mediaActivityRootSlugs = mediaActivityEntitySchemaSlugs.filter(
	(slug) => slug !== "show-episode" && slug !== "podcast-episode",
);

const targetRecipe = defineRecipe((entityId: string) => {
	const entity = table("entity", "historyCorrectionTarget");
	return {
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: { id: selectedField(column(entity, "id"), Schema.String) },
				where: and(
					eq(column(entity, "id"), literal(entityId)),
					or(
						...mediaActivityRootSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	};
});

export const manifest = defineManifest({
	kind: "operation",
	name: "Retry media history correction",
	slug: "operation.media-history-correction-retry",
});

export default defineOperation({
	manifest,
	input: MediaHistoryCorrectionRetryInput,
	output: MediaHistoryCorrectionRetryOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const target = yield* executeRyotqlRecipe(host.executeRyotql, targetRecipe(input.entityId));
			if (target === undefined) {
				return yield* Effect.fail(new OperationRejectedError("Media activity is unavailable"));
			}
			const key = `${input.entityId}:retry:${input.submissionId}`;
			return yield* host.requestUserWork(
				{
					key,
					scope: input.entityId,
					input: {
						force: true,
						workKey: key,
						liveSourceIds: [],
						conflictAttempt: 0,
						entityId: input.entityId,
						requestKey: input.submissionId,
					},
				},
				historyCorrectionReference,
			);
		}),
});
