import { Schema } from "effect";

import { EntityId, EventId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import { strictStruct } from "../../schema/utils";
import { EventMutationChange } from "../events/mutations";

export const CommandEntityReference = Schema.Union([
	strictStruct({ kind: Schema.Literal("root") }),
	strictStruct({ entityId: EntityId, kind: Schema.Literal("existing") }),
]);
const properties = Schema.Record(Schema.String, JsonValue);
export const UserCommand = strictStruct({
	relationships: Schema.Array(
		strictStruct({
			properties,
			source: CommandEntityReference,
			target: CommandEntityReference,
			relationshipSchemaSlug: Schema.NonEmptyString,
			propertiesMode: Schema.Literals(["merge", "replace"]),
		}),
	),
	entity: strictStruct({
		properties,
		name: Schema.NonEmptyString,
		entitySchemaSlug: Schema.NonEmptyString,
		target: Schema.Union([
			strictStruct({ kind: Schema.Literal("create") }),
			strictStruct({
				entityId: EntityId,
				kind: Schema.Literal("update"),
				expected: strictStruct({ properties, name: Schema.String, updatedAt: Schema.String }),
			}),
		]),
	}),
	events: strictStruct({
		changes: Schema.Array(
			Schema.Union([EventMutationChange.members[1], EventMutationChange.members[2]]),
		),
		expected: Schema.optional(
			strictStruct({ eventIds: Schema.Array(EventId), eventSchemaSlug: Schema.NonEmptyString }),
		),
		creates: Schema.Array(
			strictStruct({
				properties,
				entity: CommandEntityReference,
				itemIdentity: Schema.NonEmptyString,
				eventSchemaSlug: Schema.NonEmptyString,
				occurredAt: Schema.optional(Schema.String),
				session: Schema.optional(CommandEntityReference),
			}),
		),
	}),
});
export type UserCommand = typeof UserCommand.Type;
export const UserCommandResult = strictStruct({
	entityId: EntityId,
	events: Schema.Array(strictStruct({ eventId: EventId, itemIdentity: Schema.NonEmptyString })),
});
export type UserCommandResult = typeof UserCommandResult.Type;
