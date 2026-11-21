import { Schema } from "effect";

import { EntityId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

/** A user entity: the change set's root entity, or one that already exists. */
export const ChangeSetEntityReference = Schema.Union([
	strictStruct({ kind: Schema.Literal("root") }),
	strictStruct({ entityId: EntityId, kind: Schema.Literal("existing") }),
]);
export type ChangeSetEntityReference = typeof ChangeSetEntityReference.Type;

/** A global entity: one that already exists, or one this change set upserts. */
export const ChangeSetGlobalEntityReference = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("existing") }),
	strictStruct({
		kind: Schema.Literal("upserted"),
		externalId: Schema.NonEmptyString,
		entitySchemaSlug: Schema.NonEmptyString,
	}),
]);
export type ChangeSetGlobalEntityReference = typeof ChangeSetGlobalEntityReference.Type;
