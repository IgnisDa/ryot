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
	or,
	parameters,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";
import { reviewProperties } from "@ryot-app/plugin-kit/schema";

import {
	MediaReviewCreateInput,
	MediaReviewOutput,
	reviewPositionError,
} from "../../shared/media-review-operations";
import { mediaLibraryMemberEntitySchemaSlugs } from "../../shared/media-schema-slugs";
import { requireReviewConsumption } from "./media-review-consumption";

const reviewTargetRecipe = (() => {
	const inputParameters = parameters({
		fields: {
			entityId: {
				type: "string",
				label: "Entity Id",
				validation: { required: true },
				description: "Entity Id for this selection",
			},
		},
	});
	const entity = table("entity", "reviewTarget");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ target }) => Result.succeed(target),
		queries: {
			target: selectedOptionalRow(entity, {
				orderBy: [ascending(column(entity, "id"))],
				selection: {
					id: selectedField(column(entity, "id"), Schema.String),
					entitySchemaSlug: selectedField(column(entity, "entitySchemaSlug"), Schema.String),
				},
				where: and(
					eq(column(entity, "id"), inputParameters.value("entityId")),
					or(
						...mediaLibraryMemberEntitySchemaSlugs.map((slug) =>
							entitySchemaPredicate(entity, slug, { kind: "self" }),
						),
					),
				),
			}),
		},
	});
})();
export const manifest = defineManifest({
	kind: "operation",
	name: "Create media review",
	slug: "operation.media-review-create",
});

export default defineOperation({
	manifest,
	output: MediaReviewOutput,
	input: MediaReviewCreateInput,
	run: (input, host) =>
		Effect.gen(function* () {
			const target = yield* executeRyotqlRecipe(host.executeRyotql, reviewTargetRecipe, {
				entityId: input.entityId,
			});
			if (target === undefined) {
				return yield* new OperationRejectedError({ message: "Review target not found" });
			}
			const { position, consumptionEventId } = input;
			const positionError = reviewPositionError(target.entitySchemaSlug, position);
			if (positionError !== undefined) {
				return yield* new OperationRejectedError({ message: positionError });
			}
			if (consumptionEventId) {
				yield* requireReviewConsumption(host, { entityId: target.id, eventId: consumptionEventId });
			}
			return yield* host.createEvents([
				{
					entityId: target.id,
					eventSchemaSlug: "review",
					properties: {
						...reviewProperties(input),
						...(position ? { position } : {}),
						...(consumptionEventId ? { consumptionEventId } : {}),
					},
				},
			]);
		}),
});
