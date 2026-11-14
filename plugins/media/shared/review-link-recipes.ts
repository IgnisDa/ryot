import { Result, Schema } from "@ryot-app/plugin-kit/effect";
import {
	and,
	column,
	defineRecipe,
	eq,
	eventOrderDescending,
	inArray,
	IsoDateString,
	literal,
	parameters,
	type Recipe,
	schemaOwnerPredicate,
	selectedField,
	type SelectedRow,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { EventId, type PluginIdentityReference } from "@ryot-app/plugin-kit/schema";

import { MediaPosition } from "./consumption";
import { propertyBoolean, propertyJson, propertyText, type Table } from "./entity-selections";
import { eventSchemaIsOneOf, mediaReviewEventSelection } from "./media-recipes";
import { mediaReviewConsumptionSlugs } from "./media-review-operations";

/** Event IDs, named occurrences and naming reviews resolved by one review links query. */
export const MEDIA_REVIEW_LINK_LIMIT = 100;

const occurrenceSelection = (event: Table) => ({
	id: selectedField(column(event, "id"), EventId),
	createdAt: selectedField(column(event, "createdAt"), IsoDateString),
	occurredAt: selectedField(column(event, "occurredAt"), IsoDateString),
	position: selectedField(propertyJson(event, "position"), Schema.NullOr(MediaPosition)),
	calendarDate: selectedField(propertyText(event, "calendarDate"), Schema.NullOr(Schema.String)),
	dateUnknown: selectedField(propertyBoolean(event, "dateUnknown"), Schema.NullOr(Schema.Boolean)),
	eventSchemaSlug: selectedField(
		column(event, "eventSchemaSlug"),
		Schema.Literals(mediaReviewConsumptionSlugs),
	),
});

const occurrences = (event: Table, reference: PluginIdentityReference) =>
	and(
		schemaOwnerPredicate(event, "eventSchemaPluginId", reference),
		eventSchemaIsOneOf(event, mediaReviewConsumptionSlugs),
	);
/** The occurrences that reviews name, and the reviews that name each occurrence, among `eventIds`. */
export const mediaReviewLinksRecipe = (input: { readonly reference: PluginIdentityReference }) => {
	const inputParameters = parameters({
		fields: {
			eventIds: {
				type: "array",
				label: "eventIds",
				validation: { required: true },
				description: "eventIds for this selection",
				items: { label: "ID", type: "string", description: "Selected ID" },
			},
		},
	});
	const occurrence = table("event", "reviewLinkOccurrence");
	const review = table("event", "reviewLinkReview");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ reviews, occurrences: named }) =>
			Result.succeed({ reviews: reviews.items, occurrences: named.items }),
		queries: {
			occurrences: selectedRows(occurrence, {
				limit: MEDIA_REVIEW_LINK_LIMIT,
				orderBy: eventOrderDescending(occurrence),
				selection: occurrenceSelection(occurrence),
				where: and(
					occurrences(occurrence, input.reference),
					inArray(column(occurrence, "id"), inputParameters.list("eventIds")),
				),
			}),
			reviews: selectedRows(review, {
				limit: MEDIA_REVIEW_LINK_LIMIT,
				orderBy: eventOrderDescending(review),
				where: and(
					schemaOwnerPredicate(review, "eventSchemaPluginId", input.reference),
					eq(column(review, "eventSchemaSlug"), literal("review")),
					inArray(propertyText(review, "consumptionEventId"), inputParameters.list("eventIds")),
				),
				selection: {
					...mediaReviewEventSelection(review),
					consumptionEventId: selectedField(propertyText(review, "consumptionEventId"), EventId),
					position: selectedField(propertyJson(review, "position"), Schema.NullOr(MediaPosition)),
				},
			}),
		},
	});
};
export type MediaLinkedReview = MediaReviewLinks["reviews"][number];
export type MediaReviewLinks = Recipe.Success<ReturnType<typeof mediaReviewLinksRecipe>>;
/** Recent completions, progress and status records of one entity, newest first. */
export const mediaReviewableOccurrencesRecipe = (input: {
	readonly reference: PluginIdentityReference;
}) => {
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
	const event = table("event", "reviewableOccurrence");
	return defineRecipe({
		parameters: inputParameters.schema,
		map: ({ events }) => Result.succeed(events.items),
		queries: {
			events: selectedRows(event, {
				limit: 100,
				orderBy: eventOrderDescending(event),
				selection: occurrenceSelection(event),
				where: and(
					occurrences(event, input.reference),
					eq(column(event, "entityId"), inputParameters.value("entityId")),
				),
			}),
		},
	});
};
export type MediaReviewOccurrence = SelectedRow<ReturnType<typeof occurrenceSelection>>;
