import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipSnapshot,
	type AutomationRelationshipRequestPayload,
	type AutomationRelationshipChangePayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	definitionOwner,
	type RelationshipSchemaReference,
	definitionOwnerPluginId,
} from "@ryot-app/contract/modules/plugins/references";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
	RelationshipScope,
	CreateRelationshipBody,
} from "@ryot-app/contract/modules/relationships/schemas";
import { type EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { createUserRelationshipSchema } from "@ryot-app/plugin-backend-sdk/core";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Schema } from "effect";

import type { ManagedAssetReferenceLocker } from "#lib/domain/managed-asset-writes";
import type { LifecycleExecution } from "#modules/automations/lifecycle/execution";
import {
	LifecyclePersistenceError,
	type LifecyclePlanner,
} from "#modules/automations/lifecycle/planning";
import { parseAppSchemaProperties } from "#modules/definitions/properties/runtime";
import type { DefinitionRepository } from "#modules/definitions/repository";
import type { RelationshipSchemaDefinition } from "#modules/definitions/snapshot";
import type { EntitiesRepository } from "#modules/entities/repository";
import {
	DomainLifecycleCommand,
	type DomainWriteChecks,
	DomainWriteConflict,
	writerPropertiesSchema,
} from "#modules/entities/write-context";
import {
	mutationReceiptIdentity,
	mutationReceiptOwner,
	MutationReceiptIdentity,
	type MutationReceipts,
} from "#modules/mutations/receipts";
import {
	CatalogDefinitionFingerprint,
	type PluginRuntimeResolver,
} from "#modules/plugins/catalog/runtime-resolver";
import { type DatabaseSession, DatabaseSessionStateError } from "#platform/db/session";
import { runRootTransaction } from "#platform/db/transaction";

import {
	RelationshipIdentityInput,
	type RelationshipsRepository,
	relationshipMutationLockKey,
} from "./repository";

export const CreateRelationshipInput = Schema.Union([
	Schema.Struct({
		...CreateRelationshipBody.fields,
		properties: Schema.Unknown,
		scope: Schema.Literal("global"),
		ifAbsent: Schema.optional(Schema.Boolean),
	}),
	Schema.Struct({
		...CreateRelationshipBody.fields,
		userId: UserId,
		properties: Schema.Unknown,
		scope: Schema.Literal("user"),
		ifAbsent: Schema.optional(Schema.Boolean),
	}),
]);
export type CreateRelationshipInput = typeof CreateRelationshipInput.Type;
export type UpdateRelationshipInput = CreateRelationshipInput;
export type UserRelationshipIdentity = Omit<CreateRelationshipBody, "properties">;
export type ChangeUserRelationshipBatch = {
	creates: ReadonlyArray<
		UserRelationshipIdentity &
			Pick<Schema.Schema.Type<typeof createUserRelationshipSchema>, "propertiesMode"> & {
				properties: unknown;
			}
	>;
	deletes: ReadonlyArray<UserRelationshipIdentity>;
};
export type ReconcileGlobalRelationshipGroup = {
	relationshipSchema: RelationshipSchemaReference;
	selector:
		| { type: "self" }
		| { type: "anchored"; direction: "incoming" | "outgoing"; anchorEntityId: EntityId };
	relationships: ReadonlyArray<{
		properties: unknown;
		sourceEntityId: EntityId;
		targetEntityId: EntityId;
	}>;
};
export type RelationshipReconciliationScope =
	| { readonly scope: "global" }
	| { readonly scope: "user"; readonly userId: UserId };
export type DeleteRelationshipInput = UserRelationshipIdentity & RelationshipReconciliationScope;
export type PlannedRelationshipReconciliationResult = ReadonlyArray<{
	readonly created: number;
	readonly updated: number;
	readonly deleted: number;
	readonly upserted: number;
}>;

export const RelationshipMutation = Schema.Struct({
	command: DomainLifecycleCommand,
	input: RelationshipIdentityInput,
	properties: Schema.optional(Schema.Unknown),
	propertiesSchema: Schema.optional(AppSchema),
	receipt: Schema.optional(MutationReceiptIdentity),
	schemaFingerprint: Schema.optional(CatalogDefinitionFingerprint),
	mode: Schema.Literals(["upsert", "update", "delete", "merge", "ensure"]),
});
export type Mutation = typeof RelationshipMutation.Type;

export const RelationshipRecordedResult = Schema.Struct({
	operation: Schema.Literals(["create", "update", "delete", "noop"]),
	relationship: Schema.NullOr(
		Schema.Struct({
			...RelationshipScope.fields,
			updatedAt: Schema.String,
			properties: Schema.Record(Schema.String, Schema.Unknown),
		}),
	),
});

export const relationshipReceiptIdentity = (
	mutation: Pick<Mutation, "command" | "input" | "mode" | "properties" | "receipt">,
) =>
	mutation.receipt ??
	mutationReceiptIdentity({
		command: mutation.command,
		commandKind: `relationship:${mutation.mode}`,
		scopeUserId: mutation.input.scope === "user" ? mutation.input.userId : null,
		ownerUserId: mutationReceiptOwner(
			mutation.command,
			mutation.input.scope === "user" ? mutation.input.userId : null,
		),
		input: {
			scope: mutation.input.scope,
			writeContext: mutation.command.writeContext,
			...(mutation.input.scope === "user" ? { userId: mutation.input.userId } : {}),
			properties: mutation.properties ?? null,
			sourceEntityId: mutation.input.sourceEntityId,
			targetEntityId: mutation.input.targetEntityId,
			relationshipSchemaSlug: mutation.input.relationshipSchemaSlug,
			relationshipSchemaPluginId: mutation.input.relationshipSchemaPluginId,
		},
	});

export const relationshipChange = (
	request: AutomationRelationshipRequestPayload,
	persisted: AutomationRelationshipSnapshot,
): AutomationRelationshipChangePayload => {
	if (request.operation === "create") {
		return { after: persisted, category: "change", operation: "create", resource: "relationship" };
	}
	if (request.operation === "update") {
		return {
			after: persisted,
			category: "change",
			operation: "update",
			before: request.before,
			resource: "relationship",
		};
	}
	return { before: persisted, category: "change", operation: "delete", resource: "relationship" };
};
export const equal = (left: unknown, right: unknown) =>
	stableStringify(left) === stableStringify(right);
export const relationshipKey = (input: { sourceEntityId: EntityId; targetEntityId: EntityId }) =>
	`${input.sourceEntityId}\u0000${input.targetEntityId}`;
export const badProperties = (paths: ReadonlyArray<ReadonlyArray<string>>) =>
	new RelationshipBadRequest({ reason: { paths, code: "invalid-properties" } });
export const relationshipWriteFailure = (error: DbError | DomainWriteConflict) =>
	new RelationshipBadRequest({
		reason:
			error instanceof DomainWriteConflict
				? error.reason
				: { code: "concurrent-relationship-change" },
	});
export const parseProperties = (properties: unknown, propertiesSchema: AppSchema, strict = false) =>
	parseAppSchemaProperties({
		properties,
		kind: "Relationship",
		propertiesSchema: strict ? writerPropertiesSchema(propertiesSchema) : propertiesSchema,
	}).pipe(Effect.mapError((error) => badProperties(error.issues.map(({ path }) => path))));
export const snapshot = (
	row: NonNullable<
		Effect.Success<ReturnType<RelationshipsRepository["Service"]["findRelationship"]>>
	>,
) =>
	Schema.decodeUnknownEffect(AutomationRelationshipSnapshot)({
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		properties: row.properties,
		sourceEntityId: row.sourceEntityId,
		targetEntityId: row.targetEntityId,
		relationshipSchemaSlug: row.relationshipSchemaSlug,
		relationshipSchemaPluginId: row.relationshipSchemaPluginId,
	}).pipe(
		Effect.mapError(() => new DbError({ message: "Invalid persisted relationship snapshot" })),
	);
export const mergeProperties = (existing: unknown, incoming: unknown) => {
	const current = isObjectRecord(existing) ? existing : {};
	const values = isObjectRecord(incoming) ? incoming : {};
	const merged = { ...current, ...values };
	for (const [key, value] of Object.entries(values)) {
		if (Array.isArray(value) && Array.isArray(current[key])) {
			const seen = new Set<string>();
			merged[key] = [...current[key], ...value].filter((item) => {
				const encoded = stableStringify(item);
				if (seen.has(encoded)) {
					return false;
				}
				seen.add(encoded);
				return true;
			});
		}
	}
	return merged;
};

export const rootTransaction =
	(session: DatabaseSession["Service"]) =>
	<A, E, R>(work: Effect.Effect<A, E, R>) =>
		runRootTransaction(session, work).pipe(
			Effect.mapError((error) =>
				error instanceof DatabaseSessionStateError
					? new DbError({
							message: "Relationship lifecycle mutations require a root transaction boundary",
						})
					: error,
			),
		);

export const rootTransactionGuard = (session: DatabaseSession["Service"]) =>
	session.requireRoot.pipe(
		Effect.mapError(
			() =>
				new DbError({
					message: "Relationship lifecycle mutations require a root transaction boundary",
				}),
		),
	);

export const itemCommand = (
	command: DomainLifecycleCommand,
	input: RelationshipIdentityInput,
	suffix: string,
): DomainLifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${suffix}:${relationshipMutationLockKey(input)}`,
});

export type UserEntityScopes = Effect.Success<
	ReturnType<EntitiesRepository["Service"]["getEntityScopesForUser"]>
>;

export const validateUserRelationshipEntities = Effect.fnUntraced(function* (
	scopes: UserEntityScopes,
	input: Pick<UserRelationshipIdentity, "sourceEntityId" | "targetEntityId">,
	definition: RelationshipSchemaDefinition,
	userId: UserId,
) {
	const source = scopes.get(input.sourceEntityId);
	const target = scopes.get(input.targetEntityId);
	if (!source || !target) {
		return yield* new RelationshipNotFound({
			reason: { code: "entity-not-found", entityIds: [input.sourceEntityId, input.targetEntityId] },
		});
	}
	if (definition.userWritePolicy === "source-owner" && source.entityUserId !== userId) {
		return yield* new RelationshipBadRequest({
			reason: { code: "source-not-owned", sourceEntityId: input.sourceEntityId },
		});
	}
	if (
		(definition.pluginId !== null || definition.sourceEntitySchemaSlug !== null) &&
		source.entitySchemaPluginId !== definition.pluginId
	) {
		return yield* new RelationshipBadRequest({
			reason: {
				code: "owner-mismatch",
				expected: definitionOwner(definition.pluginId),
				actual: definitionOwner(source.entitySchemaPluginId),
			},
		});
	}
	if (
		(definition.pluginId !== null || definition.targetEntitySchemaSlug !== null) &&
		target.entitySchemaPluginId !== definition.pluginId
	) {
		return yield* new RelationshipBadRequest({
			reason: {
				code: "owner-mismatch",
				expected: definitionOwner(definition.pluginId),
				actual: definitionOwner(target.entitySchemaPluginId),
			},
		});
	}
	if (
		definition.sourceEntitySchemaSlug &&
		(definition.sourceEntitySchemaSlug !== source.entitySchemaSlug ||
			source.entitySchemaPluginId !== definition.pluginId)
	) {
		return yield* new RelationshipBadRequest({
			reason: {
				code: "source-schema-mismatch",
				actual: source.entitySchemaSlug,
				expected: definition.sourceEntitySchemaSlug,
			},
		});
	}
	if (
		definition.targetEntitySchemaSlug &&
		(definition.targetEntitySchemaSlug !== target.entitySchemaSlug ||
			target.entitySchemaPluginId !== definition.pluginId)
	) {
		return yield* new RelationshipBadRequest({
			reason: {
				code: "target-schema-mismatch",
				actual: target.entitySchemaSlug,
				expected: definition.targetEntitySchemaSlug,
			},
		});
	}
	return undefined;
});

export const relationshipSchemaReference = (
	input: Pick<RelationshipIdentityInput, "relationshipSchemaPluginId" | "relationshipSchemaSlug">,
): RelationshipSchemaReference => ({
	slug: input.relationshipSchemaSlug,
	owner: definitionOwner(input.relationshipSchemaPluginId),
});

export const relationshipIdentity = (
	input: DeleteRelationshipInput,
): RelationshipIdentityInput => ({
	...input,
	relationshipSchemaSlug: input.relationshipSchema.slug,
	relationshipSchemaPluginId: definitionOwnerPluginId(input.relationshipSchema.owner),
});

export type RelationshipMutationDependencies = {
	readonly writes: DomainWriteChecks["Service"];
	readonly session: DatabaseSession["Service"];
	readonly execution: LifecycleExecution["Service"];
	readonly planner: LifecyclePlanner["Service"];
	readonly receipts: MutationReceipts["Service"];
	readonly repository: RelationshipsRepository["Service"];
	readonly runtime: PluginRuntimeResolver["Service"];
	readonly definitions: DefinitionRepository["Service"];
	readonly entities: EntitiesRepository["Service"];
	readonly assetReferences: ManagedAssetReferenceLocker["Service"];
};

/** Persistence phases run inside the caller's transaction rather than opening their own. */
export const activeTransactionGuard = (session: DatabaseSession["Service"]) =>
	session.requireTransaction.pipe(
		Effect.mapError(() => new LifecyclePersistenceError({ code: "active-transaction-required" })),
	);
