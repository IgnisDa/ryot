import { DbError } from "@ryot-app/contract/errors";
import {
	type DeclarationReference,
	definitionKey,
	type EntitySchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import {
	and,
	asc,
	count,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Schema } from "effect";
import { chunksOf } from "effect/Array";

import { DefinitionRepository } from "#modules/definitions/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import {
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/catalog/runtime-resolver";
import { pluginIdWhere } from "#platform/db/definition-owner";
import { DatabaseSession } from "#platform/db/session";
import * as schema from "#schema/tables/combined";

import {
	type EntitySchemaProviderDetailsScope,
	type EntitySchemaScope,
	entitySelection,
	entityVisibleToUserClause,
	toListedEntity,
} from "./repository-support";

export type InsertEntityInputBase = {
	id?: EntityId;
	createdAt?: Date;
	name: string;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
} & (
	| {
			scope: "global";
			populatedAt: Date | null;
			externalId?: string | undefined;
			providerId?: SandboxProviderId | undefined;
	  }
	| {
			scope: "user";
			userId: UserId;
			populatedAt?: Date | null;
			externalId?: string | undefined;
			providerId?: SandboxProviderId | undefined;
	  }
);

export type InsertEntityInput = InsertEntityInputBase & { properties: Record<string, unknown> };

export type UpdateEntityInput = {
	name: string;
	entityId: EntityId;
	populatedAt: Date | null;
	preservePopulatedAt?: boolean;
	properties: Record<string, unknown>;
};

export type GlobalEntityProvenanceScopeInput = {
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
};

export type ProviderEntityMutationLockInput = {
	entitySchemaPluginId: string | null;
	externalId: string;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

export const EntityPopulationFailure = Schema.Literals(schema.ENTITY_POPULATION_FAILURES);
export type EntityPopulationFailure = typeof EntityPopulationFailure.Type;

const previousEntity = alias(schema.entity, "previous_entity");

type StoredEntity = ReturnType<typeof toListedEntity>;
export const STATEMENT_CHUNK_SIZE = 1_000;

export type MutationEntity = { entity: StoredEntity; userId: UserId | null };

export const lockSortedAdvisoryKeys = Effect.fnUntraced(function* (
	session: DatabaseSession["Service"],
	keys: ReadonlyArray<string>,
	hash: SQL,
) {
	for (const chunk of chunksOf([...new Set(keys)].sort(), STATEMENT_CHUNK_SIZE)) {
		yield* session.run((db) =>
			db.execute(
				sql`select pg_advisory_xact_lock(${hash}) from unnest(array[${sql.join(
					chunk.map((key) => sql`${key}`),
					sql`, `,
				)}]::text[]) with ordinality t(k, n) order by n`,
			),
		);
	}
});

export const providerEntityMutationLockKey = (input: ProviderEntityMutationLockInput) =>
	JSON.stringify([
		"provider-entity",
		input.scope,
		input.scope === "user" ? input.userId : "global",
		input.entitySchemaPluginId,
		input.entitySchemaSlug,
		input.providerId,
		input.externalId,
	]);

export type PortableEntityRecord = Pick<
	typeof schema.entity.$inferSelect,
	| "id"
	| "name"
	| "createdAt"
	| "updatedAt"
	| "properties"
	| "externalId"
	| "populatedAt"
	| "entitySchemaPluginId"
	| "entitySchemaSlug"
> & { readonly provider: { readonly pluginId: string; readonly providerSlug: string } | null };

const portableEntitySelection = {
	id: schema.entity.id,
	name: schema.entity.name,
	providerPluginId: schema.plugin.id,
	createdAt: schema.entity.createdAt,
	updatedAt: schema.entity.updatedAt,
	properties: schema.entity.properties,
	externalId: schema.entity.externalId,
	populatedAt: schema.entity.populatedAt,
	providerSlug: schema.sandboxProvider.slug,
	entitySchemaSlug: schema.entity.entitySchemaSlug,
	entitySchemaPluginId: schema.entity.entitySchemaPluginId,
};

const toPortableEntity = (
	row: Omit<PortableEntityRecord, "provider"> & {
		readonly providerPluginId: string | null;
		readonly providerSlug: string | null;
	},
): PortableEntityRecord => {
	const { providerSlug, providerPluginId, ...entity } = row;
	return {
		...entity,
		provider:
			providerSlug === null || providerPluginId === null
				? null
				: { providerSlug, pluginId: providerPluginId },
	};
};

const entitySchemaPluginWhere = (pluginId: string | null) =>
	pluginIdWhere(schema.entity.entitySchemaPluginId, pluginId);

type FindEntityByExternalIdInput = {
	externalId: string;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

const externalIdentityWhere = (input: FindEntityByExternalIdInput) =>
	and(
		input.scope === "user" ? eq(schema.entity.userId, input.userId) : isNull(schema.entity.userId),
		eq(schema.entity.externalId, input.externalId),
		eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
		eq(schema.entity.providerId, input.providerId),
		entitySchemaPluginWhere(input.entitySchemaPluginId),
	);

const findEntityByExternalIdWithSession = (
	session: DatabaseSession["Service"],
	input: FindEntityByExternalIdInput,
) =>
	Effect.gen(function* () {
		const [row] = yield* session.run((db) =>
			db.select(entitySelection).from(schema.entity).where(externalIdentityWhere(input)).limit(1),
		);

		return row ? toListedEntity(row) : null;
	});

const findPopulationTargetWithSession = (
	session: DatabaseSession["Service"],
	input: FindEntityByExternalIdInput,
) =>
	Effect.gen(function* () {
		const [row] = yield* session.run((db) =>
			db
				.select({ ...entitySelection, relatedPopulatedAt: schema.entity.relatedPopulatedAt })
				.from(schema.entity)
				.where(externalIdentityWhere(input))
				.limit(1),
		);
		return row
			? { entity: toListedEntity(row), relatedPopulated: row.relatedPopulatedAt !== null }
			: null;
	});

export const provenanceScopeKey = (input: GlobalEntityProvenanceScopeInput) =>
	stableStringify([
		"global-entities",
		input.entitySchemaPluginId,
		input.entitySchemaSlug,
		input.providerId,
	]);

const provenanceScopeWhere = (input: GlobalEntityProvenanceScopeInput) =>
	and(
		eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
		eq(schema.entity.providerId, input.providerId),
		entitySchemaPluginWhere(input.entitySchemaPluginId),
	);

export const ensureScopeKey = (input: {
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
}) => stableStringify([input.entitySchemaSlug, input.entitySchemaPluginId]);

const entityValues = (input: InsertEntityInput) => ({
	id: input.id,
	name: input.name,
	createdAt: input.createdAt,
	updatedAt: input.createdAt,
	properties: input.properties,
	externalId: input.externalId ?? null,
	providerId: input.providerId ?? null,
	entitySchemaSlug: input.entitySchemaSlug,
	entitySchemaPluginId: input.entitySchemaPluginId ?? null,
	...(input.scope === "global"
		? { userId: null, populatedAt: input.populatedAt }
		: { userId: input.userId, populatedAt: input.populatedAt ?? null }),
});

export class EntitiesRepository extends Context.Service<EntitiesRepository>()(
	"EntitiesRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const eventStreams = yield* EventStreamRepository.make;
			const pluginRuntime = yield* PluginRuntimeResolver;
			const definitions = yield* DefinitionRepository;
			const lockSchemaCatalog = pluginRuntime.lockCatalog;
			const findEntityByExternalId = (input: FindEntityByExternalIdInput) =>
				findEntityByExternalIdWithSession(session, input);
			const findPopulationTarget = (input: FindEntityByExternalIdInput) =>
				findPopulationTargetWithSession(session, input);
			const findUserEntitySchema = Effect.fn(function* (
				userId: UserId,
				reference: EntitySchemaReference,
			) {
				return (
					(yield* definitions.findUserEntitySchemas(userId, [reference]))[
						definitionKey("entity", reference.owner, reference.slug)
					] ?? null
				);
			});
			const lockProviderEntityMutations = Effect.fn(
				"EntitiesRepository.lockProviderEntityMutations",
			)(function* (inputs: ReadonlyArray<ProviderEntityMutationLockInput>) {
				yield* lockSortedAdvisoryKeys(
					session,
					inputs.map(providerEntityMutationLockKey),
					sql`hashtextextended(k, 0)`,
				);
			});
			const findEntitiesByExternalIds = Effect.fn("EntitiesRepository.findEntitiesByExternalIds")(
				function* (inputs: ReadonlyArray<FindEntityByExternalIdInput>) {
					const rows = yield* Effect.forEach(chunksOf(inputs, STATEMENT_CHUNK_SIZE), (chunk) =>
						session.run((db) =>
							db
								.select({ ...entitySelection, userId: schema.entity.userId })
								.from(schema.entity)
								.where(or(...chunk.map(externalIdentityWhere))),
						),
					).pipe(Effect.map((chunks) => chunks.flat()));
					return new Map(
						rows.flatMap(({ userId, ...row }) =>
							row.externalId === null || row.providerId === null
								? []
								: [
										[
											providerEntityMutationLockKey({
												externalId: row.externalId,
												entitySchemaPluginId: row.entitySchemaPluginId,
												providerId: SandboxProviderId.make(row.providerId),
												entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
												...(userId === null
													? { scope: "global" as const }
													: { scope: "user" as const, userId: UserId.make(userId) }),
											}),
											toListedEntity(row),
										] as const,
									],
						),
					);
				},
			);
			const lockEntityReferencesByIds = Effect.fn("EntitiesRepository.lockEntityReferencesByIds")(
				function* (entityIds: ReadonlyArray<EntityId>) {
					for (const ids of chunksOf([...new Set(entityIds)].sort(), STATEMENT_CHUNK_SIZE)) {
						yield* session.run((db) =>
							db
								.select({ id: schema.entity.id })
								.from(schema.entity)
								.where(inArray(schema.entity.id, ids))
								.orderBy(sql`${schema.entity.id} collate "C"`)
								.for("key share"),
						);
					}
				},
			);
			const listMatchCandidatesBySchema = Effect.fn(
				"EntitiesRepository.listMatchCandidatesBySchema",
			)(function* (input: { userId: UserId; entitySchema: EntitySchemaReference }) {
				const definition = yield* findUserEntitySchema(input.userId, input.entitySchema);
				if (!definition) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								entityVisibleToUserClause(input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchema.slug),
								entitySchemaPluginWhere(definition.pluginId),
							),
						)
						.orderBy(
							sql`case when ${schema.entity.userId} = ${input.userId} then 0 else 1 end`,
							asc(schema.entity.name),
							asc(schema.entity.createdAt),
						),
				);
				return rows.map(toListedEntity);
			});

			const listEntityReferencesByIds = Effect.fn("EntitiesRepository.listEntityReferencesByIds")(
				function* (entityIds: ReadonlyArray<EntityId>) {
					if (entityIds.length === 0) {
						return [];
					}

					const rows = yield* session.run((db) =>
						db
							.select({
								id: schema.entity.id,
								name: schema.entity.name,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(inArray(schema.entity.id, [...entityIds]))
							.orderBy(asc(schema.entity.id)),
					);

					return rows.map((row) => ({
						name: row.name,
						id: EntityId.make(row.id),
						entitySchemaSlug: row.entitySchemaSlug,
						entitySchemaPluginId: row.entitySchemaPluginId,
					}));
				},
			);
			const listUserEntitiesForBackup = Effect.fn("EntitiesRepository.listUserEntitiesForBackup")(
				function* (userId: UserId) {
					const rows = yield* session.run((db) =>
						db
							.select(portableEntitySelection)
							.from(schema.entity)
							.leftJoin(
								schema.sandboxProvider,
								eq(schema.entity.providerId, schema.sandboxProvider.id),
							)
							.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
							.where(eq(schema.entity.userId, userId))
							.orderBy(asc(schema.entity.id)),
					);
					return rows.map(toPortableEntity);
				},
			);

			const listReferencedGlobalEntitiesForBackup = Effect.fn(
				"EntitiesRepository.listReferencedGlobalEntitiesForBackup",
			)(function* (userId: UserId) {
				const rows = yield* session.run((db) =>
					db
						.select(portableEntitySelection)
						.from(schema.entity)
						.leftJoin(
							schema.sandboxProvider,
							eq(schema.entity.providerId, schema.sandboxProvider.id),
						)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.where(
							and(
								isNull(schema.entity.userId),
								or(
									exists(
										db
											.select({ id: schema.relationship.id })
											.from(schema.relationship)
											.where(
												and(
													eq(schema.relationship.userId, userId),
													or(
														eq(schema.relationship.sourceEntityId, schema.entity.id),
														eq(schema.relationship.targetEntityId, schema.entity.id),
													),
												),
											),
									),
									exists(
										db
											.select({ id: schema.event.id })
											.from(schema.event)
											.where(
												and(
													eq(schema.event.userId, userId),
													or(
														eq(schema.event.entityId, schema.entity.id),
														eq(schema.event.sessionEntityId, schema.entity.id),
													),
												),
											),
									),
								),
							),
						)
						.orderBy(asc(schema.entity.id)),
				);
				return rows.map(toPortableEntity);
			});

			const listGlobalEntitiesByIdsForBackup = Effect.fn(
				"EntitiesRepository.listGlobalEntitiesByIdsForBackup",
			)(function* (entityIds: ReadonlyArray<EntityId>) {
				if (entityIds.length === 0) {
					return [];
				}
				const rows = yield* session.run((db) =>
					db
						.select(portableEntitySelection)
						.from(schema.entity)
						.leftJoin(
							schema.sandboxProvider,
							eq(schema.entity.providerId, schema.sandboxProvider.id),
						)
						.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
						.where(and(isNull(schema.entity.userId), inArray(schema.entity.id, [...entityIds])))
						.orderBy(asc(schema.entity.id)),
				);
				return rows.map(toPortableEntity);
			});

			const findEntitySchemaForUser = Effect.fn("EntitiesRepository.findEntitySchemaForUser")(
				function* (input: { userId: UserId; entitySchema: EntitySchemaReference }) {
					const definition = yield* findUserEntitySchema(input.userId, input.entitySchema);
					const scope: EntitySchemaScope | null = definition
						? {
								userId: null,
								slug: definition.slug,
								pluginId: definition.pluginId,
								isBuiltin: definition.pluginId === null,
								id: EntitySchemaSlug.make(definition.slug),
								propertiesSchema: definition.propertiesSchema,
							}
						: null;
					return scope;
				},
			);

			const findUserEntityWithoutProvenance = Effect.fn(
				"EntitiesRepository.findUserEntityWithoutProvenance",
			)(function* (input: {
				userId: UserId;
				entitySchemaSlug: EntitySchemaSlug;
				entitySchemaPluginId: string | null;
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.userId, input.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								entitySchemaPluginWhere(input.entitySchemaPluginId),
								isNull(schema.entity.externalId),
								isNull(schema.entity.providerId),
							),
						)
						.orderBy(asc(schema.entity.createdAt), asc(schema.entity.id))
						.limit(1),
				);
				return row ? toListedEntity(row) : null;
			});

			const findUserEntitiesWithoutProvenance = Effect.fn(
				"EntitiesRepository.findUserEntitiesWithoutProvenance",
			)(function* (input: {
				userId: UserId;
				scopes: ReadonlyArray<{
					entitySchemaSlug: EntitySchemaSlug;
					entitySchemaPluginId: string | null;
				}>;
			}) {
				if (input.scopes.length === 0) {
					return new Map<string, StoredEntity>();
				}
				const rows = yield* session.run((db) =>
					db
						.selectDistinctOn(
							[schema.entity.entitySchemaSlug, schema.entity.entitySchemaPluginId],
							entitySelection,
						)
						.from(schema.entity)
						.where(
							and(
								eq(schema.entity.userId, input.userId),
								or(
									...input.scopes.map((scope) =>
										and(
											eq(schema.entity.entitySchemaSlug, scope.entitySchemaSlug),
											entitySchemaPluginWhere(scope.entitySchemaPluginId),
										),
									),
								),
								isNull(schema.entity.externalId),
								isNull(schema.entity.providerId),
							),
						)
						.orderBy(
							asc(schema.entity.entitySchemaSlug),
							asc(schema.entity.entitySchemaPluginId),
							asc(schema.entity.createdAt),
							asc(schema.entity.id),
						),
				);
				return new Map(
					rows.map((row) => [
						ensureScopeKey({
							entitySchemaPluginId: row.entitySchemaPluginId,
							entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						}),
						toListedEntity(row),
					]),
				);
			});

			const lockUserEntityEnsureScopes = Effect.fn("EntitiesRepository.lockUserEntityEnsureScopes")(
				function* (input: { userId: UserId; entitySchemas: ReadonlyArray<EntitySchemaReference> }) {
					yield* lockSortedAdvisoryKeys(
						session,
						input.entitySchemas.map((reference) =>
							stableStringify([
								"user-entity:ensure",
								input.userId,
								definitionKey("entity", reference.owner, reference.slug),
							]),
						),
						sql`hashtext(k)`,
					);
				},
			);

			const listEntityScopes = (where: SQL | undefined) =>
				session
					.run((db) =>
						db
							.select({
								entityId: schema.entity.id,
								entityName: schema.entity.name,
								entityUserId: schema.entity.userId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(where),
					)
					.pipe(
						Effect.map((rows) =>
							rows.map((row) => ({
								...row,
								entityId: EntityId.make(row.entityId),
								isBuiltin: row.entitySchemaPluginId === null,
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
								entityUserId: row.entityUserId ? UserId.make(row.entityUserId) : null,
							})),
						),
					);
			const getEntityScopeForUser = Effect.fn("EntitiesRepository.getEntityScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const [scope] = yield* listEntityScopes(
						and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
					);
					return scope ?? null;
				},
			);
			const getEntityScopesForUser = Effect.fn("EntitiesRepository.getEntityScopesForUser")(
				function* (entityIds: ReadonlyArray<EntityId>, userId: UserId) {
					const scopes = yield* Effect.forEach(
						chunksOf([...new Set(entityIds)], STATEMENT_CHUNK_SIZE),
						(ids) =>
							listEntityScopes(
								and(inArray(schema.entity.id, ids), entityVisibleToUserClause(userId)),
							),
					);
					return new Map(scopes.flat().map((scope) => [scope.entityId, scope]));
				},
			);

			const getEntityMergeScopeForUser = Effect.fn("EntitiesRepository.getEntityMergeScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								entityId: schema.entity.id,
								entityUserId: schema.entity.userId,
								properties: schema.entity.properties,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(
								and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
							)
							.limit(1),
					);

					return row
						? {
								...row,
								entityId: EntityId.make(row.entityId),
								isBuiltin: row.entitySchemaPluginId === null,
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
								entityUserId: row.entityUserId ? UserId.make(row.entityUserId) : null,
							}
						: null;
				},
			);

			const getByIdForUser = Effect.fn("EntitiesRepository.getByIdForUser")(function* (input: {
				userId: UserId;
				entityId: EntityId;
			}) {
				const [row] = yield* session.run((db) =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(
							and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
						)
						.limit(1),
				);

				return row ? toListedEntity(row) : null;
			});
			const getByIdsForUser = Effect.fn("EntitiesRepository.getByIdsForUser")(function* (input: {
				userId: UserId;
				entityIds: ReadonlyArray<EntityId>;
			}) {
				const rows = yield* Effect.forEach(
					chunksOf([...new Set(input.entityIds)].sort(), STATEMENT_CHUNK_SIZE),
					(ids) =>
						session.run((db) =>
							db
								.select(entitySelection)
								.from(schema.entity)
								.where(
									and(inArray(schema.entity.id, ids), entityVisibleToUserClause(input.userId)),
								),
						),
				).pipe(Effect.map((chunks) => chunks.flat()));
				return new Map(rows.map((row) => [EntityId.make(row.id), toListedEntity(row)]));
			});

			const getClientPageEntityForUser = Effect.fn("EntitiesRepository.getClientPageEntityForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								entityId: schema.entity.id,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(
								and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
							)
							.limit(1),
					);
					return row
						? {
								...row,
								entityId: EntityId.make(row.entityId),
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
							}
						: null;
				},
			);

			const getById = Effect.fn("EntitiesRepository.getById")(function* (entityId: EntityId) {
				const [row] = yield* session.run((db) =>
					db
						.select(entitySelection)
						.from(schema.entity)
						.where(eq(schema.entity.id, entityId))
						.limit(1),
				);
				return row ? toListedEntity(row) : null;
			});

			const findGlobalEntityById = Effect.fn("EntitiesRepository.findGlobalEntityById")(function* (
				entityId: EntityId,
			) {
				const [row] = yield* session.run((db) =>
					db
						.select({
							id: schema.entity.id,
							entitySchemaSlug: schema.entity.entitySchemaSlug,
							entitySchemaPluginId: schema.entity.entitySchemaPluginId,
						})
						.from(schema.entity)
						.where(and(eq(schema.entity.id, entityId), isNull(schema.entity.userId)))
						.limit(1),
				);
				return row
					? {
							id: EntityId.make(row.id),
							entitySchemaPluginId: row.entitySchemaPluginId,
							entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						}
					: null;
			});

			const findGlobalEntityForRestore = Effect.fn("EntitiesRepository.findGlobalEntityForRestore")(
				function* (input: {
					externalId: string;
					entitySchemaSlug: EntitySchemaSlug;
					entitySchemaPluginId: string | null;
					provider: DeclarationReference | null;
				}) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								id: schema.entity.id,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.leftJoin(
								schema.sandboxProvider,
								eq(schema.entity.providerId, schema.sandboxProvider.id),
							)
							.leftJoin(schema.plugin, eq(schema.plugin.id, schema.sandboxProvider.pluginId))
							.where(
								and(
									isNull(schema.entity.userId),
									eq(schema.entity.externalId, input.externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
									input.provider === null
										? isNull(schema.entity.providerId)
										: and(
												input.provider.owner.kind === "plugin"
													? eq(schema.plugin.id, input.provider.owner.pluginId)
													: sql`false`,
												isNull(schema.plugin.ownerId),
												eq(schema.sandboxProvider.slug, input.provider.slug),
											),
								),
							)
							.limit(1),
					);
					return row
						? {
								id: EntityId.make(row.id),
								entitySchemaPluginId: row.entitySchemaPluginId,
								entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
							}
						: null;
				},
			);

			const lockGlobalEntityProvenanceScopes = Effect.fn(
				"EntitiesRepository.lockGlobalEntityProvenanceScopes",
			)(function* (inputs: ReadonlyArray<GlobalEntityProvenanceScopeInput>) {
				yield* lockSortedAdvisoryKeys(session, inputs.map(provenanceScopeKey), sql`hashtext(k)`);
			});

			const countGlobalEntitiesByProvenanceScopes = Effect.fn(
				"EntitiesRepository.countGlobalEntitiesByProvenanceScopes",
			)(function* (inputs: ReadonlyArray<GlobalEntityProvenanceScopeInput>) {
				const scopes = [
					...new Map(inputs.map((input) => [provenanceScopeKey(input), input])).values(),
				];
				const rows = yield* Effect.forEach(chunksOf(scopes, STATEMENT_CHUNK_SIZE), (chunk) =>
					session.run((db) =>
						db
							.select({
								count: count(),
								providerId: schema.entity.providerId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(and(isNull(schema.entity.userId), or(...chunk.map(provenanceScopeWhere))))
							.groupBy(
								schema.entity.providerId,
								schema.entity.entitySchemaSlug,
								schema.entity.entitySchemaPluginId,
							),
					),
				).pipe(Effect.map((chunks) => chunks.flat()));
				return new Map(
					rows.flatMap((row) =>
						row.providerId === null
							? []
							: [
									[
										provenanceScopeKey({
											entitySchemaPluginId: row.entitySchemaPluginId,
											providerId: SandboxProviderId.make(row.providerId),
											entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
										}),
										row.count,
									] as const,
								],
					),
				);
			});

			const findSystemEntitySchemaByReference = (reference: EntitySchemaReference) =>
				definitions.findGlobalEntitySchema(reference).pipe(
					Effect.map((definition) => {
						return definition
							? {
									slug: definition.slug,
									propertiesSchema: definition.propertiesSchema,
									...(definition.pluginId == null ? {} : { pluginId: definition.pluginId }),
								}
							: null;
					}),
				);

			const findEntitySchemaProviderByReference = Effect.fn(
				"EntitiesRepository.findEntitySchemaProviderByReference",
			)(function* (reference: DeclarationReference) {
				const resolved = yield* pluginRuntime.findSchemaProviderByReference(reference);
				if (!resolved) {
					return null;
				}

				const detailsScript = yield* pluginRuntime.findDetailsScript(resolved.provider.id);
				return detailsScript
					? ({
							providerId: resolved.provider.id,
							detailsScriptId: detailsScript.id,
							entitySchemaSlug: resolved.entitySchemaSlug,
						} satisfies EntitySchemaProviderDetailsScope)
					: null;
			});

			const insertEntities = Effect.fn("EntitiesRepository.insertEntities")(function* (
				inputs: ReadonlyArray<InsertEntityInput>,
			) {
				const rows = yield* Effect.forEach(chunksOf(inputs, STATEMENT_CHUNK_SIZE), (chunk) =>
					session.run((db) =>
						db
							.insert(schema.entity)
							.values(chunk.map(entityValues))
							.onConflictDoNothing()
							.returning(entitySelection),
					),
				);
				return rows.flat().map(toListedEntity);
			});

			const hasUserCollectionNamed = Effect.fn("EntitiesRepository.hasUserCollectionNamed")(
				function* (input: { userId: UserId; name: string }) {
					const [row] = yield* session.run((db) =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.name, input.name),
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.entitySchemaSlug, "collection"),
									isNull(schema.entity.entitySchemaPluginId),
								),
							)
							.limit(1),
					);
					return row !== undefined;
				},
			);

			const updateEntity = Effect.fn("EntitiesRepository.updateEntity")(function* (
				input: UpdateEntityInput,
			) {
				yield* session.requireTransaction;
				const [current] = yield* session.run((db) =>
					db
						.select({ name: schema.entity.name, properties: schema.entity.properties })
						.from(schema.entity)
						.where(eq(schema.entity.id, input.entityId))
						.limit(1)
						.for("update"),
				);
				if (!current) {
					return yield* new DbError({ message: "Entity update returned no row" });
				}
				const streamDataChanged =
					current.name !== input.name ||
					stableStringify(current.properties) !== stableStringify(input.properties);
				const [updated] = yield* session.run((db) =>
					db
						.update(schema.entity)
						.set({
							name: input.name,
							properties: input.properties,
							populatedAt: input.preservePopulatedAt
								? sql`coalesce(${input.populatedAt?.toISOString() ?? null}::timestamptz, ${schema.entity.populatedAt})`
								: input.populatedAt,
							...(input.populatedAt === null
								? {}
								: { populationFailure: null, populationFailedAt: null }),
						})
						.where(eq(schema.entity.id, input.entityId))
						.returning(entitySelection),
				);

				if (!updated) {
					return yield* new DbError({ message: "Entity update returned no row" });
				}
				if (streamDataChanged) {
					yield* eventStreams.invalidateEntity(input.entityId);
				}

				return toListedEntity(updated);
			});

			const markFailed = Effect.fnUntraced(function* (
				input: { entityId: EntityId; failedAt: Date; failure: EntityPopulationFailure },
				set: (
					failure: EntityPopulationFailure,
					failedAt: Date,
				) => Partial<typeof schema.entity.$inferInsert>,
				conditions: readonly SQL[],
			) {
				yield* session.requireTransaction;
				const failure = yield* Schema.decodeEffect(EntityPopulationFailure)(input.failure).pipe(
					Effect.mapError((error) => new DbError({ message: error.message })),
				);
				const rows = yield* session.run((db) =>
					db
						.update(schema.entity)
						.set(set(failure, input.failedAt))
						.where(
							and(
								eq(schema.entity.id, input.entityId),
								...conditions,
								isNotNull(schema.entity.providerId),
								isNotNull(schema.entity.externalId),
							),
						)
						.returning({ id: schema.entity.id }),
				);
				return rows.length > 0;
			});

			const markPopulationFailed = Effect.fn("EntitiesRepository.markPopulationFailed")(
				(input: { entityId: EntityId; failedAt: Date; failure: EntityPopulationFailure }) =>
					markFailed(
						input,
						(populationFailure, populationFailedAt) => ({ populationFailure, populationFailedAt }),
						[isNull(schema.entity.populatedAt)],
					),
			);

			const markRelatedPopulationFailed = Effect.fn(
				"EntitiesRepository.markRelatedPopulationFailed",
			)((input: { entityId: EntityId; failedAt: Date; failure: EntityPopulationFailure }) =>
				markFailed(
					input,
					(relatedPopulationFailure, relatedPopulationFailedAt) => ({
						relatedPopulationFailure,
						relatedPopulationFailedAt,
					}),
					[isNotNull(schema.entity.populatedAt), isNull(schema.entity.relatedPopulatedAt)],
				),
			);

			const stampRelatedPopulated = Effect.fn("EntitiesRepository.stampRelatedPopulated")(
				function* (entityId: EntityId, relatedPopulatedAt: Date) {
					yield* session.requireTransaction;
					yield* session.run((db) =>
						db
							.update(schema.entity)
							.set({
								relatedPopulatedAt,
								relatedPopulationFailure: null,
								relatedPopulationFailedAt: null,
							})
							.where(eq(schema.entity.id, entityId)),
					);
				},
			);

			const stampChildRelatedPopulated = Effect.fn("EntitiesRepository.stampChildRelatedPopulated")(
				function* (entityIds: ReadonlyArray<EntityId>) {
					yield* session.requireTransaction;
					for (const ids of chunksOf([...new Set(entityIds)].sort(), STATEMENT_CHUNK_SIZE)) {
						yield* session.run((db) =>
							db
								.update(schema.entity)
								.set({ relatedPopulatedAt: sql`${schema.entity.populatedAt}` })
								.where(
									and(
										inArray(schema.entity.id, ids),
										isNotNull(schema.entity.populatedAt),
										isNull(schema.entity.relatedPopulatedAt),
									),
								),
						);
					}
				},
			);

			const clearPopulationFailure = Effect.fn("EntitiesRepository.clearPopulationFailure")(
				function* (entityId: EntityId) {
					yield* session.requireTransaction;
					const relatedFailureClearable = and(
						isNotNull(schema.entity.relatedPopulationFailedAt),
						isNull(schema.entity.relatedPopulatedAt),
					);
					const [row] = yield* session.run((db) =>
						db
							.update(schema.entity)
							.set({
								populationFailure: null,
								populationFailedAt: null,
								relatedPopulationFailure: sql`case when ${schema.entity.relatedPopulatedAt} is null then null else ${schema.entity.relatedPopulationFailure} end`,
								relatedPopulationFailedAt: sql`case when ${schema.entity.relatedPopulatedAt} is null then null else ${schema.entity.relatedPopulationFailedAt} end`,
							})
							.from(previousEntity)
							.where(
								and(
									eq(schema.entity.id, entityId),
									eq(previousEntity.id, schema.entity.id),
									or(isNotNull(schema.entity.populationFailedAt), relatedFailureClearable),
								),
							)
							.returning({
								userId: schema.entity.userId,
								failedAt: previousEntity.populationFailedAt,
								relatedPopulatedAt: previousEntity.relatedPopulatedAt,
								relatedFailedAt: previousEntity.relatedPopulationFailedAt,
							}),
					);
					if (row === undefined) {
						return null;
					}
					const relatedFailedAt = row.relatedPopulatedAt === null ? row.relatedFailedAt : null;
					return {
						relatedFailedAt,
						failedAt: row.failedAt,
						userId: row.userId === null ? null : UserId.make(row.userId),
					};
				},
			);

			const deleteByIds = Effect.fn("EntitiesRepository.deleteByIds")(function* (
				ids: readonly [EntityId, ...EntityId[]],
			) {
				const rows = yield* Effect.forEach(chunksOf(ids, STATEMENT_CHUNK_SIZE), (chunk) =>
					session.run((db) =>
						db
							.delete(schema.entity)
							.where(inArray(schema.entity.id, chunk))
							.returning({ id: schema.entity.id }),
					),
				);
				return rows.flat().length;
			});

			const lockMutationKeys = Effect.fn("EntitiesRepository.lockMutationKeys")(function* (
				keys: ReadonlyArray<string>,
			) {
				yield* lockSortedAdvisoryKeys(
					session,
					keys.map((key) => `entity-mutation:${key}`),
					sql`hashtextextended(k, 0)`,
				);
			});
			const getMutationEntity = Effect.fn("EntitiesRepository.getMutationEntity")(function* (
				entityId: EntityId,
				lock = false,
			) {
				const [row] = yield* session.run((db) => {
					const query = db
						.select({ ...entitySelection, userId: schema.entity.userId })
						.from(schema.entity)
						.where(eq(schema.entity.id, entityId))
						.limit(1);
					return lock ? query.for("update") : query;
				});
				return row
					? {
							entity: toListedEntity(row),
							userId: row.userId === null ? null : UserId.make(row.userId),
						}
					: null;
			});
			const getMutationEntities = Effect.fn("EntitiesRepository.getMutationEntities")(function* (
				entityIds: ReadonlyArray<EntityId>,
				lock = false,
			) {
				const rows = yield* Effect.forEach(
					chunksOf([...new Set(entityIds)].sort(), STATEMENT_CHUNK_SIZE),
					(ids) =>
						session.run((db) => {
							const query = db
								.select({ ...entitySelection, userId: schema.entity.userId })
								.from(schema.entity)
								.where(inArray(schema.entity.id, ids))
								.orderBy(sql`${schema.entity.id} collate "C"`);
							return lock ? query.for("update") : query;
						}),
				).pipe(Effect.map((chunks) => chunks.flat()));
				return new Map(
					rows.map(({ userId, ...row }) => [
						EntityId.make(row.id),
						{ entity: toListedEntity(row), userId: userId === null ? null : UserId.make(userId) },
					]),
				);
			});

			return {
				getById,
				deleteByIds,
				updateEntity,
				insertEntities,
				getByIdForUser,
				getByIdsForUser,
				lockMutationKeys,
				getMutationEntity,
				lockSchemaCatalog,
				getMutationEntities,
				markPopulationFailed,
				findPopulationTarget,
				findGlobalEntityById,
				stampRelatedPopulated,
				getEntityScopeForUser,
				clearPopulationFailure,
				hasUserCollectionNamed,
				findEntityByExternalId,
				getEntityScopesForUser,
				findEntitySchemaForUser,
				findEntitiesByExternalIds,
				listEntityReferencesByIds,
				listUserEntitiesForBackup,
				lockEntityReferencesByIds,
				getClientPageEntityForUser,
				lockUserEntityEnsureScopes,
				getEntityMergeScopeForUser,
				stampChildRelatedPopulated,
				findGlobalEntityForRestore,
				markRelatedPopulationFailed,
				lockProviderEntityMutations,
				listMatchCandidatesBySchema,
				findUserEntityWithoutProvenance,
				lockGlobalEntityProvenanceScopes,
				listGlobalEntitiesByIdsForBackup,
				findUserEntitiesWithoutProvenance,
				findSystemEntitySchemaByReference,
				findEntitySchemaProviderByReference,
				countGlobalEntitiesByProvenanceScopes,
				listReferencedGlobalEntitiesForBackup,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const EntitiesRepositoryLive = EntitiesRepository.layer.pipe(
	Layer.provide(PluginRuntimeResolverLive),
	Layer.provide(DefinitionRepository.layer),
);
