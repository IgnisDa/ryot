import { Schema } from "effect";

import { EntityId } from "../../schema/brands";
import { IsoUtcString, strictStruct } from "../../schema/utils";
import { AutomationWarning } from "../automations/lifecycle";
import { EntitySchemaReference } from "../plugins/references";

const properties = Schema.Record(Schema.String, Schema.Unknown);

export const EntityEditorRelationshipTarget = strictStruct({ properties, entityId: EntityId });
export type EntityEditorRelationshipTarget = typeof EntityEditorRelationshipTarget.Type;

const relationships = Schema.Array(
	strictStruct({
		relationshipSchemaSlug: Schema.String,
		targets: Schema.Array(EntityEditorRelationshipTarget),
	}),
);

export const EntityEditorSaveSubmission = strictStruct({
	properties,
	relationships,
	action: Schema.Literal("save"),
	entitySchema: EntitySchemaReference,
	name: Schema.String.pipe(
		Schema.check(Schema.makeFilter((name) => name.trim().length > 0 || "Expected a name")),
	),
	target: Schema.Union([
		strictStruct({ kind: Schema.Literal("create") }),
		strictStruct({
			entityId: EntityId,
			kind: Schema.Literal("update"),
			expected: strictStruct({
				properties,
				relationships,
				name: Schema.String,
				updatedAt: Schema.String,
			}),
		}),
	]),
});
export type EntityEditorSaveSubmission = typeof EntityEditorSaveSubmission.Type;

export const EntityEditorDeleteSubmission = strictStruct({
	entityId: EntityId,
	expectedUpdatedAt: Schema.String,
	action: Schema.Literal("delete"),
	entitySchema: EntitySchemaReference,
});
export type EntityEditorDeleteSubmission = typeof EntityEditorDeleteSubmission.Type;

export const EntityEditorSubmission = Schema.Union([
	EntityEditorSaveSubmission,
	EntityEditorDeleteSubmission,
]);
export type EntityEditorSubmission = typeof EntityEditorSubmission.Type;

export const EntityEditorSaveRequest = strictStruct({
	submittedAt: IsoUtcString,
	submission: EntityEditorSubmission,
	idempotencyKey: Schema.String.pipe(
		Schema.check(Schema.isMinLength(1)),
		Schema.check(Schema.isMaxLength(128)),
	),
});
export type EntityEditorSaveRequest = typeof EntityEditorSaveRequest.Type;

export const retryableEntityEditorSaveRequest = (
	previous: undefined | EntityEditorSaveRequest,
	submission: EntityEditorSubmission,
	now: Date,
): EntityEditorSaveRequest =>
	previous !== undefined && JSON.stringify(previous.submission) === JSON.stringify(submission)
		? previous
		: { submission, submittedAt: now.toISOString(), idempotencyKey: crypto.randomUUID() };

export const EntityEditorSaveOutput = Schema.Union([
	strictStruct({ entityId: EntityId, kind: Schema.Literal("saved") }),
	strictStruct({ kind: Schema.Literal("deleted") }),
	strictStruct({ kind: Schema.Literal("stale") }),
	strictStruct({ message: Schema.String, kind: Schema.Literal("invalid") }),
]);
export type EntityEditorSaveOutput = typeof EntityEditorSaveOutput.Type;

export const EntityEditorSaveResult = Schema.Struct({
	output: EntityEditorSaveOutput,
	warnings: Schema.Array(AutomationWarning),
});
export type EntityEditorSaveResult = typeof EntityEditorSaveResult.Type;

export class EntityEditorRefused extends Schema.TaggedError<
	EntityEditorRefused,
	{ readonly brand: unique symbol }
>()("EntityEditorRefused", { message: Schema.String }) {}
