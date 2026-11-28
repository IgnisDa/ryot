import { Schema } from "effect";

import { EntityId, EventId, RelationshipId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import { CalendarDate } from "../analytics/reporting";
import { EventChange } from "./mutations";

export const FOLD_LIMITS = {
	changes: 500,
	runSubjects: 25,
	inputChanges: 500,
	valueBytes: 262_144,
	requestEntities: 100,
	inputBytes: 1_048_576,
};

/** The value of a subject that merged or restored into this one, with the IDs it holds and what they became. */
export const FoldAbsorbed = strictStruct({
	value: JsonValue,
	ids: Schema.Record(Schema.String, Schema.String),
});

/** An event as the fold sees it: `orderKey` and `orderCreatedAt` fall back to its ID and creation time. */
export const FoldEventImage = strictStruct({
	id: EventId,
	entityId: EntityId,
	revision: Schema.Int,
	orderKey: Schema.String,
	occurredAt: Schema.String,
	orderCreatedAt: Schema.String,
	eventSchemaSlug: Schema.String,
	entitySchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(EntityId),
	properties: Schema.Record(Schema.String, JsonValue),
});
export type FoldEventImage = typeof FoldEventImage.Type;

/** `before` is the event while it belonged to the subject and `after` is it now; null outside the subject. */
export const FoldEventChange = strictStruct({
	after: Schema.NullOr(FoldEventImage),
	before: Schema.NullOr(FoldEventImage),
});
export type FoldEventChange = typeof FoldEventChange.Type;

/** One subject of a fold run: what the fold returned last time, absorbed values, and its changed events or null to replay. */
export const FoldSubjectInput = strictStruct({
	value: JsonValue,
	subjectEntityId: EntityId,
	absorbed: Schema.Array(FoldAbsorbed),
	changes: Schema.NullOr(Schema.Array(FoldEventChange)),
});
export type FoldSubjectInput = typeof FoldSubjectInput.Type;

export const FoldInput = strictStruct({
	subjects: Schema.Array(FoldSubjectInput).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(FOLD_LIMITS.runSubjects),
	),
});
export type FoldInput = typeof FoldInput.Type;

/**
 * When a subject's value next changes on its own, with no write: at the start of `date` in the
 * user's reporting time zone, or at `instant`.
 */
export const FoldRefresh = Schema.Union([
	strictStruct({ date: CalendarDate }),
	strictStruct({ instant: IsoUtcString }),
]);
export type FoldRefresh = typeof FoldRefresh.Type;

/** What a fold derived for one subject, and when to fold it again with no change. */
export const FoldResult = strictStruct({
	value: JsonValue,
	refresh: Schema.optionalKey(FoldRefresh),
	changes: Schema.Array(EventChange).check(Schema.isMaxLength(FOLD_LIMITS.changes)),
	events: Schema.Array(
		strictStruct({ eventId: EventId, properties: Schema.Record(Schema.String, JsonValue) }),
	),
	relationships: Schema.Array(
		strictStruct({
			relationshipId: RelationshipId,
			properties: Schema.Record(Schema.String, JsonValue),
		}),
	),
});
export type FoldResult = typeof FoldResult.Type;

export const FoldSubjectOutput = strictStruct({ ...FoldResult.fields, subjectEntityId: EntityId });
export type FoldSubjectOutput = typeof FoldSubjectOutput.Type;

/** One result per input subject. */
export const FoldOutput = strictStruct({ subjects: Schema.Array(FoldSubjectOutput) });
export type FoldOutput = typeof FoldOutput.Type;

/** Folds entities again with no change, as for a change only to data outside their events. */
export const FoldRequest = strictStruct({
	entityIds: Schema.Array(EntityId).check(
		Schema.isMinLength(1),
		Schema.isMaxLength(FOLD_LIMITS.requestEntities),
	),
});
export type FoldRequest = typeof FoldRequest.Type;
