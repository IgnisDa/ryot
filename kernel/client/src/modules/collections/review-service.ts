import {
	type ReviewContent,
	reviewProperties,
	reviewPropertiesPatch,
	reviewPropertyKeys,
} from "@ryot-app/contract/modules/events/review";
import type { EventWritePrecondition } from "@ryot-app/contract/modules/events/schemas";
import { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import type { EntityId, EventId } from "@ryot-app/contract/schema/brands";
import { createRyotHostMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	collectionReviewsRecipe,
	type CollectionReviewsResult,
} from "@ryot-app/ryotql-recipes/collection-reviews";
import { Effect, Schema } from "effect";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { EventsApi } from "#/api/events";
import { KernelHostServices } from "#/host-services";

export type CollectionReview = CollectionReviewsResult["items"][number];
type ReviewCommand =
	| { readonly action: "delete"; readonly eventId: EventId }
	| {
			readonly action: "save";
			readonly draft: ReviewContent;
			readonly collectionId: EntityId;
			readonly initial: null | CollectionReview;
	  };

export class ReviewNotSaved extends Schema.TaggedError<
	ReviewNotSaved,
	{ readonly brand: unique symbol }
>()("ReviewNotSaved", {}) {}

export const collectionReviewsQuery = createRyotQuery<
	Parameters<typeof collectionReviewsRecipe>[0],
	CollectionReviewsResult
>(({ input, client }) => client.data.query(collectionReviewsRecipe(input)));

const reviewPrecondition = (review: CollectionReview): EventWritePrecondition => {
	const properties = review.properties;
	return {
		properties,
		kind: "fields",
		entityId: review.entityId,
		occurredAt: review.occurredAt,
		sessionEntityId: review.sessionEntityId,
		absentProperties: reviewPropertyKeys.filter((key) => !Object.hasOwn(properties, key)),
	};
};

export const collectionReviewMutation = createRyotHostMutation<
	{ readonly onSaved: () => void; readonly command: ReviewCommand },
	void,
	KernelHostServices,
	ReviewNotSaved | AuthenticatedApiError
>(
	({ input, hostServices }) =>
		Effect.gen(function* () {
			const api = hostServices.runtime.runSync(EventsApi);
			const command = input.command;
			if (command.action === "delete") {
				yield* api.delete(hostServices.scope, { params: { eventId: command.eventId } });
			} else {
				const { draft, initial } = command;
				if (initial === null) {
					const result = yield* api.create(hostServices.scope, {
						payload: [
							{
								entityId: command.collectionId,
								properties: reviewProperties(draft),
								eventSchemaSlug: EventSchemaSlug.make("review"),
							},
						],
					});
					if (result.outcomes[0]?.status !== "written") {
						return yield* new ReviewNotSaved();
					}
				} else {
					yield* api.update(hostServices.scope, {
						params: { eventId: initial.id },
						payload: {
							expected: reviewPrecondition(initial),
							properties: reviewPropertiesPatch(draft),
						},
					});
				}
			}
			return input.onSaved();
		}),
	{ hostServices: KernelHostServices },
);
