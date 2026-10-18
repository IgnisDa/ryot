import { Schema } from "effect";

import { EventId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import {
	CreateEventItem,
	EventOrderAnchor,
	EventUpdatePatch,
	EventWritePrecondition,
	UpdateEventItem,
} from "./schemas";

export const EventMutationChange = Schema.Union([
	strictStruct({
		item: CreateEventItem,
		kind: Schema.Literal("create"),
		itemIdentity: Schema.NonEmptyString,
	}),
	strictStruct({
		kind: Schema.Literal("update"),
		itemIdentity: Schema.NonEmptyString,
		item: strictStruct({
			...UpdateEventItem.fields,
			patch: strictStruct({
				...EventUpdatePatch.fields,
				orderAfter: Schema.optional(Schema.NullOr(EventOrderAnchor)),
			}).check(Schema.makeFilter((patch) => Object.keys(patch).length > 0)),
		}),
	}),
	strictStruct({
		eventId: EventId,
		kind: Schema.Literal("delete"),
		itemIdentity: Schema.NonEmptyString,
		expected: Schema.optional(EventWritePrecondition),
	}),
]);
export type EventMutationChange = typeof EventMutationChange.Type;
