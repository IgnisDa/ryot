import { PgClient } from "@effect/sql-pg";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationRelationshipSnapshot,
	AutomationRequestPayload,
	type AutomationRelationshipChangePayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot-app/contract/modules/relationships/schemas";
import type { EntityId, RelationshipSchemaSlug, UserId } from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Option, Schema } from "effect";

import { LifecyclePersistenceError, type LifecyclePlanner } from "#lib/domain/lifecycle";
import { LifecycleCommand } from "#lib/domain/lifecycle-command";
import type { LifecycleExecution } from "#lib/domain/lifecycle-execution";
import { Database, mapDatabaseErrors, retryOnDeadlock } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import type { RelationshipSchemaDefinition } from "#modules/definition-registry/snapshot";
import { EntitiesRepository } from "#modules/entities/repository";
import type { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";
import { CatalogDefinitionFingerprint } from "#modules/plugins/runtime-resolver";

import {
	RelationshipIdentityInput,
	type RelationshipsRepository,
	relationshipMutationLockKey,
} from "./repository";

export type CreateRelationshipInput = RelationshipIdentityInput & { properties: unknown };
export type UpdateRelationshipInput = CreateRelationshipInput;
export type UserRelationshipIdentity = {
	sourceEntityId: EntityId;
	targetEntityId: EntityId;
	relationshipSchemaSlug: RelationshipSchemaSlug;
};
export type ChangeUserRelationshipBatch = {
	creates: ReadonlyArray<UserRelationshipIdentity & { properties: unknown }>;
	deletes: ReadonlyArray<UserRelationshipIdentity>;
};
export type ReconcileGlobalRelationshipGroup = {
	relationshipSchemaSlug: RelationshipSchemaSlug;
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
export type PlannedRelationshipReconciliationResult = ReadonlyArray<{
	readonly created: number;
	readonly updated: number;
	readonly deleted: number;
	readonly upserted: number;
}>;

export const RelationshipMutation = Schema.Struct({
	command: LifecycleCommand,
	input: RelationshipIdentityInput,
	properties: Schema.optional(Schema.Unknown),
	propertiesSchema: Schema.optional(AppSchema),
	mode: Schema.Literals(["upsert", "update", "delete", "merge"]),
	schemaFingerprint: Schema.optional(CatalogDefinitionFingerprint),
});
export type Mutation = typeof RelationshipMutation.Type;
export const RelationshipRequest = Schema.Union([
	AutomationRequestPayload.members[6],
	AutomationRequestPayload.members[7],
	AutomationRequestPayload.members[8],
]);
export type RelationshipRequest = typeof RelationshipRequest.Type;

export const relationshipChange = (
	request: RelationshipRequest,
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
export const populationIdentity = (value: LifecycleCommand["population"]) =>
	value ? { ...value, batch: value.batch ? { id: value.batch.id } : undefined } : undefined;
export const equal = (left: unknown, right: unknown) =>
	stableStringify(left) === stableStringify(right);
export const relationshipKey = (input: { sourceEntityId: EntityId; targetEntityId: EntityId }) =>
	`${input.sourceEntityId}\u0000${input.targetEntityId}`;
export const badProperties = (paths: ReadonlyArray<ReadonlyArray<string>>) =>
	new RelationshipBadRequest({ reason: { paths, code: "invalid-properties" } });
export const parseProperties = (properties: unknown, propertiesSchema: AppSchema) =>
	parseAppSchemaProperties({ properties, propertiesSchema, kind: "Relationship" }).pipe(
		Effect.mapError((error) => badProperties(error.issues.map(({ path }) => path))),
	);
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

export const transaction = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const database = yield* Database;
		return yield* retryOnDeadlock(
			mapDatabaseErrors(
				database.transaction((tx) => work.pipe(Effect.provideService(Database, tx))),
			),
		);
	});

export const assertRootTransaction = Effect.gen(function* () {
	const client = yield* PgClient.PgClient;
	if (Option.isSome(yield* Effect.serviceOption(client.transactionService))) {
		return yield* new DbError({
			message: "Relationship lifecycle mutations require a root transaction boundary",
		});
	}
	return undefined;
});

export const itemCommand = (
	command: LifecycleCommand,
	input: RelationshipIdentityInput,
	suffix: string,
): LifecycleCommand => ({
	...command,
	itemIdentity: `${command.itemIdentity}:${suffix}:${relationshipMutationLockKey(input)}`,
});

export const validateUserRelationshipEntities = Effect.fnUntraced(function* (
	userId: UserId,
	input: Pick<UserRelationshipIdentity, "sourceEntityId" | "targetEntityId">,
	definition: RelationshipSchemaDefinition,
) {
	const entities = yield* EntitiesRepository;
	const [source, target] = yield* Effect.all([
		entities.getEntityScopeForUser({ userId, entityId: input.sourceEntityId }),
		entities.getEntityScopeForUser({ userId, entityId: input.targetEntityId }),
	]);
	if (!source || !target) {
		return yield* new RelationshipNotFound({
			reason: { code: "entity-not-found", entityIds: [input.sourceEntityId, input.targetEntityId] },
		});
	}
	if (
		definition.sourceEntitySchemaSlug &&
		definition.sourceEntitySchemaSlug !== source.entitySchemaSlug
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
		definition.targetEntitySchemaSlug !== target.entitySchemaSlug
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

export const validateUserIdentity = Effect.fnUntraced(function* (
	userId: UserId,
	input: UserRelationshipIdentity,
) {
	const definitions = yield* DefinitionRepository;
	const definition = (yield* definitions.findUserRelationshipSchemas(userId, [
		input.relationshipSchemaSlug,
	]))[input.relationshipSchemaSlug];
	if (!definition) {
		return yield* new RelationshipNotFound({
			reason: {
				code: "relationship-schema-not-found",
				relationshipSchemaSlug: input.relationshipSchemaSlug,
			},
		});
	}
	yield* validateUserRelationshipEntities(userId, input, definition);
	return definition;
});

export type RelationshipMutationDependencies = {
	readonly client: PgClient.PgClient;
	readonly execution: LifecycleExecution["Service"];
	readonly planner: LifecyclePlanner["Service"];
	readonly repository: RelationshipsRepository["Service"];
	readonly runtime: PluginRuntimeResolver["Service"];
	readonly definitions: DefinitionRepository["Service"];
};

/** Persistence phases run inside the caller's transaction rather than opening their own. */
export const activeTransactionGuard = (client: PgClient.PgClient) =>
	Effect.serviceOption(client.transactionService).pipe(
		Effect.flatMap((active) =>
			Option.isSome(active)
				? Effect.void
				: Effect.fail(new LifecyclePersistenceError({ code: "active-transaction-required" })),
		),
	);
