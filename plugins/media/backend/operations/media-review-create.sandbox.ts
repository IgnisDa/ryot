import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
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
	MediaReviewCreateInput,
	MediaReviewCreateOutput,
} from "../../shared/media-review-operations";
import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";

class MediaReviewTargetNotFoundError extends Error {
	readonly _tag = "MediaReviewTargetNotFoundError";
}

const reviewTargetRecipe = defineRecipe((entityId: string) => {
	const entity = table("entity", "reviewTarget");
	return {
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: { id: selectedField(column(entity, "id"), Schema.String) },
				where: and(
					eq(column(entity, "id"), literal(entityId)),
					or(
						...mediaLibraryMemberEntitySchemaSlugs.map((slug) =>
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
	name: "Create media review",
	slug: "operation.media-review-create",
});

export default defineOperation({
	manifest,
	input: MediaReviewCreateInput,
	output: MediaReviewCreateOutput,
	run: (input, host) =>
		Effect.gen(function* () {
			const target = yield* executeRyotqlRecipe(
				host.executeRyotql,
				reviewTargetRecipe(input.entityId),
			);
			if (target === undefined) {
				return yield* Effect.fail(new MediaReviewTargetNotFoundError("Review target not found"));
			}
			return yield* host.createEvents([
				{
					entityId: target.id,
					eventSchemaSlug: "review",
					properties: {
						text: input.text,
						isSpoiler: input.isSpoiler,
						...(input.rating === undefined ? {} : { rating: input.rating }),
					},
				},
			]);
		}),
});
