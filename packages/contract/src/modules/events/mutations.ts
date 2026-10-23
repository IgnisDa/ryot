import { Schema } from "effect";

import { EventId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import { CreateEventItem, EventWritePrecondition, UpdateEventItem } from "./schemas";

export const EventMutationChange = Schema.Union([
	strictStruct({
		item: CreateEventItem,
		kind: Schema.Literal("create"),
		itemIdentity: Schema.NonEmptyString,
	}),
	strictStruct({
		item: UpdateEventItem,
		kind: Schema.Literal("update"),
		itemIdentity: Schema.NonEmptyString,
	}),
	strictStruct({
		eventId: EventId,
		kind: Schema.Literal("delete"),
		itemIdentity: Schema.NonEmptyString,
		expected: Schema.optional(EventWritePrecondition),
	}),
]);
export type EventMutationChange = typeof EventMutationChange.Type;
