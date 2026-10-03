import { Schema } from "effect";

import { EntityId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

const properties = Schema.Record(Schema.String, Schema.Unknown);

export const EntityEditorRelationshipTarget = strictStruct({ properties, entityId: EntityId });
export type EntityEditorRelationshipTarget = typeof EntityEditorRelationshipTarget.Type;

export const EntityEditorSubmission = strictStruct({
	properties,
	entitySchemaSlug: Schema.String,
	name: Schema.String.pipe(
		Schema.check(Schema.makeFilter((name) => name.trim().length > 0 || "Expected a name")),
	),
	relationships: Schema.Array(
		strictStruct({
			relationshipSchemaSlug: Schema.String,
			targets: Schema.Array(EntityEditorRelationshipTarget),
		}),
	),
	target: Schema.Union([
		strictStruct({ kind: Schema.Literal("create") }),
		strictStruct({
			entityId: EntityId,
			kind: Schema.Literal("update"),
			expected: strictStruct({ properties, name: Schema.String, updatedAt: Schema.String }),
		}),
	]),
});
export type EntityEditorSubmission = typeof EntityEditorSubmission.Type;

export const EntityEditorSaveOutput = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("saved") }),
	strictStruct({ kind: Schema.Literal("stale") }),
	strictStruct({ message: Schema.String, kind: Schema.Literal("invalid") }),
]);
export type EntityEditorSaveOutput = typeof EntityEditorSaveOutput.Type;
