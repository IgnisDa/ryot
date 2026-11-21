import { Schema } from "effect";

import { EventId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { ChangeSetEntityReference } from "../changes/references";
import { EventOrderAnchor, EventUpdatePatch, EventWritePrecondition } from "./schemas";

const itemIdentity = Schema.NonEmptyString;

export const EventCreate = strictStruct({
	itemIdentity,
	kind: Schema.Literal("create"),
	entity: ChangeSetEntityReference,
	eventSchemaSlug: Schema.NonEmptyString,
	occurredAt: Schema.optional(Schema.String),
	orderAfter: Schema.optional(EventOrderAnchor),
	session: Schema.optional(ChangeSetEntityReference),
	properties: Schema.Record(Schema.String, JsonValue),
});
export type EventCreate = typeof EventCreate.Type;

export const EventUpdate = strictStruct({
	itemIdentity,
	kind: Schema.Literal("update"),
	item: strictStruct({
		eventId: EventId,
		expected: Schema.optional(EventWritePrecondition),
		patch: strictStruct({
			...EventUpdatePatch.fields,
			orderAfter: Schema.optional(Schema.NullOr(EventOrderAnchor)),
		}).check(Schema.makeFilter((patch) => Object.keys(patch).length > 0)),
	}),
});
export type EventUpdate = typeof EventUpdate.Type;

export const EventDelete = strictStruct({
	itemIdentity,
	eventId: EventId,
	kind: Schema.Literal("delete"),
	expected: Schema.optional(EventWritePrecondition),
});
export type EventDelete = typeof EventDelete.Type;

/** One event change of a change set or a fold's output. A fold names only existing entities. */
export const EventChange = Schema.Union([EventCreate, EventUpdate, EventDelete]);
export type EventChange = typeof EventChange.Type;
