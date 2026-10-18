import { RELATIONSHIP_PROJECTION_LIMITS } from "@ryot-app/contract/modules/relationships/projections";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";

import { hostResultSchema, strictStruct } from "../wire";
import { GLOBAL_WRITE_SANDBOX_LIMITS, USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS } from "./limits";
import { globalPropertiesSchema, nonEmptyString, sandboxIdSchema } from "./primitives";
import { optionalSubmissionOptions } from "./writes";

export const globalRelationshipSelectorSchema = Schema.Union([
	strictStruct({ type: Schema.Literal("self") }),
	strictStruct({
		anchorEntityId: sandboxIdSchema,
		type: Schema.Literal("anchored"),
		direction: Schema.Literals(["incoming", "outgoing"]),
	}),
]);
export type GlobalRelationshipSelector = Schema.Schema.Type<
	typeof globalRelationshipSelectorSchema
>;
export const upsertGlobalRelationshipItemSchema = strictStruct({
	sourceEntityId: sandboxIdSchema,
	targetEntityId: sandboxIdSchema,
	properties: globalPropertiesSchema,
});
export type UpsertGlobalRelationshipItem = Schema.Schema.Type<
	typeof upsertGlobalRelationshipItemSchema
>;
export const upsertGlobalRelationshipGroupSchema = strictStruct({
	relationshipSchemaSlug: nonEmptyString,
	selector: globalRelationshipSelectorSchema,
	relationships: Schema.Array(upsertGlobalRelationshipItemSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.relationshipsPerGroup)),
	),
});
export type UpsertGlobalRelationshipGroup = Schema.Schema.Type<
	typeof upsertGlobalRelationshipGroupSchema
>;
export const upsertGlobalRelationshipResultSchema = strictStruct({
	deleted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	upserted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
export type UpsertGlobalRelationshipResult = Schema.Schema.Type<
	typeof upsertGlobalRelationshipResultSchema
>;
const userRelationshipIdentitySchema = strictStruct({
	sourceEntityId: sandboxIdSchema,
	targetEntityId: sandboxIdSchema,
	relationshipSchemaSlug: nonEmptyString,
});
export const createUserRelationshipSchema = strictStruct({
	...userRelationshipIdentitySchema.fields,
	properties: globalPropertiesSchema,
	propertiesMode: Schema.Literals(["merge", "replace"]),
});
export const changeUserRelationshipBatchSchema = strictStruct({
	creates: Schema.Array(createUserRelationshipSchema),
	deletes: Schema.Array(userRelationshipIdentitySchema),
}).pipe(
	Schema.check(
		Schema.makeFilter(
			(batch) =>
				batch.creates.length + batch.deletes.length <=
				USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.changesPerBatch,
		),
	),
);
export type ChangeUserRelationshipBatch = Schema.Schema.Type<
	typeof changeUserRelationshipBatchSchema
>;
export const changeUserRelationshipResultSchema = strictStruct({
	created: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
	deleted: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
export const upsertGlobalRelationshipsDataSchema = Schema.Array(
	upsertGlobalRelationshipResultSchema,
);
export const upsertGlobalRelationshipsResultSchema = hostResultSchema(
	upsertGlobalRelationshipsDataSchema,
);
export const upsertGlobalRelationshipsArgsSchema = Schema.Tuple([
	Schema.Array(upsertGlobalRelationshipGroupSchema).pipe(
		Schema.check(Schema.isMaxLength(GLOBAL_WRITE_SANDBOX_LIMITS.relationshipGroups)),
	),
]);
export const changeUserRelationshipsArgsSchema = Schema.Tuple([
	Schema.Array(changeUserRelationshipBatchSchema).pipe(
		Schema.check(Schema.isMaxLength(USER_RELATIONSHIP_WRITE_SANDBOX_LIMITS.batches)),
	),
	optionalSubmissionOptions,
]);
export const changeUserRelationshipsDataSchema = Schema.Array(changeUserRelationshipResultSchema);
export const changeUserRelationshipsResultSchema = hostResultSchema(
	changeUserRelationshipsDataSchema,
);
export const relationshipProjectionRequestSchema = strictStruct({
	relationshipSchemaSlug: nonEmptyString,
	sourceEntityIds: Schema.Array(sandboxIdSchema).pipe(
		Schema.check(
			Schema.isMinLength(1),
			Schema.isMaxLength(RELATIONSHIP_PROJECTION_LIMITS.sourceEntities),
		),
	),
});
export const requestRelationshipProjectionsArgsSchema = Schema.Tuple([
	relationshipProjectionRequestSchema,
]);
export const requestRelationshipProjectionsDataSchema = strictStruct({ workId: nonEmptyString });
export const requestRelationshipProjectionsResultSchema = hostResultSchema(
	requestRelationshipProjectionsDataSchema,
);
export const requestRelationshipProjectionsForAllUsersDataSchema = strictStruct({
	users: Schema.Number.pipe(
		Schema.check(Schema.isInt()),
		Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	),
});
export const requestRelationshipProjectionsForAllUsersResultSchema = hostResultSchema(
	requestRelationshipProjectionsForAllUsersDataSchema,
);
