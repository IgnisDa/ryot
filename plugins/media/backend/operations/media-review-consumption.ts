import type { ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Result, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { OperationRejectedError } from "@ryot-app/plugin-backend-sdk/operation";
import {
	and,
	ascending,
	column,
	defineRecipe,
	eq,
	executeRyotqlRecipe,
	literal,
	schemaOwnerPredicate,
	selectedField,
	selectedOptionalRow,
	table,
} from "@ryot-app/plugin-backend-sdk/ryotql";

import { mediaReviewConsumptionSlugs } from "../../shared/media-review-operations";

const reviewConsumptionRecipe = defineRecipe((eventId: string) => {
	const event = table("event", "reviewConsumption");
	return {
		map: ({ consumption }) => Result.succeed(consumption),
		queries: {
			consumption: selectedOptionalRow(event, {
				orderBy: [ascending(column(event, "id"))],
				where: and(
					eq(column(event, "id"), literal(eventId)),
					schemaOwnerPredicate(event, "eventSchemaPluginId", { kind: "self" }),
				),
				selection: {
					entityId: selectedField(column(event, "entityId"), Schema.String),
					eventSchemaSlug: selectedField(column(event, "eventSchemaSlug"), Schema.String),
				},
			}),
		},
	};
});

const reviewableSlugs = new Set<string>(mediaReviewConsumptionSlugs);

/** A review may name one completion, progress or status record of the entity it is written on. */
export const requireReviewConsumption = (
	host: Pick<ScriptHost, "executeRyotql">,
	input: { readonly eventId: string; readonly entityId: string },
) =>
	Effect.gen(function* () {
		const consumption = yield* executeRyotqlRecipe(
			host.executeRyotql,
			reviewConsumptionRecipe(input.eventId),
		);
		if (consumption === undefined) {
			return yield* new OperationRejectedError({
				message: "The record this review is about no longer exists.",
			});
		}
		if (!reviewableSlugs.has(consumption.eventSchemaSlug)) {
			return yield* new OperationRejectedError({
				message: "A review can only be about a completion, progress or status record.",
			});
		}
		if (consumption.entityId !== input.entityId) {
			return yield* new OperationRejectedError({
				message: "A review can only be about a record of what it reviews.",
			});
		}
		return yield* Effect.void;
	});
