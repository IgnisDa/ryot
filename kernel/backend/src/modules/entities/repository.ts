import { DbError } from "@ryot-app/contract/errors";
import {
	definitionKey,
	type EntitySchemaReference,
	type DeclarationReference,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	type SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, count, eq, exists, inArray, isNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { pluginIdWhere } from "#lib/infrastructure/db/definition-owner";
import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EventStreamRepository } from "#modules/events/stream-repository";
import {
	PluginRuntimeResolver,
	PluginRuntimeResolverLive,
} from "#modules/plugins/runtime-resolver";

import {
	entitySelection,
	entityVisibleToUserClause,
	toListedEntity,
	type EntitySchemaProviderDetailsScope,
	type EntitySchemaScope,
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

const providerWhere = (providerId: SandboxProviderId | null | undefined) =>
	providerId == null ? isNull(schema.entity.providerId) : eq(schema.entity.providerId, providerId);

type FindEntityByExternalIdInput = {
	externalId: string;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
	entitySchemaPluginId: string | null;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

const findEntityByExternalIdWithSession = (
	session: DatabaseSession["Service"],
	input: FindEntityByExternalIdInput,
) =>
	Effect.gen(function* () {
		const [row] = yield* session.run((db) =>
			db
				.select(entitySelection)
				.from(schema.entity)
				.where(
					and(
						input.scope === "user"
							? eq(schema.entity.userId, input.userId)
							: isNull(schema.entity.userId),
						eq(schema.entity.externalId, input.externalId),
						eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
						eq(schema.entity.providerId, input.providerId),
						entitySchemaPluginWhere(input.entitySchemaPluginId),
					),
				)
				.limit(1),
		);

		return row ? toListedEntity(row) : null;
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
				const keys = [...new Set(inputs.map(providerEntityMutationLockKey))].sort();
				for (const key of keys) {
					yield* session.run((db) =>
						db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`),
					);
				}
			});
			const lockEntityReferencesByIds = Effect.fn("EntitiesRepository.lockEntityReferencesByIds")(
				function* (entityIds: ReadonlyArray<EntityId>) {
					const ids = [...new Set(entityIds)].sort();
					if (ids.length === 0) {
						return;
					}
					yield* session.run((db) =>
						db
							.select({ id: schema.entity.id })
							.from(schema.entity)
							.where(inArray(schema.entity.id, ids))
							.orderBy(asc(schema.entity.id))
							.for("key share"),
					);
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

			const lockUserEntityEnsureScopes = Effect.fn("EntitiesRepository.lockUserEntityEnsureScopes")(
				function* (input: { userId: UserId; entitySchemas: ReadonlyArray<EntitySchemaReference> }) {
					const keys = [
						...new Set(
							input.entitySchemas.map((reference) =>
								stableStringify([
									"user-entity:ensure",
									input.userId,
									definitionKey("entity", reference.owner, reference.slug),
								]),
							),
						),
					].sort();
					for (const key of keys) {
						yield* session.run((db) =>
							db.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`),
						);
					}
				},
			);

			const getEntityScopeForUser = Effect.fn("EntitiesRepository.getEntityScopeForUser")(
				function* (input: { userId: UserId; entityId: EntityId }) {
					const [row] = yield* session.run((db) =>
						db
							.select({
								entityId: schema.entity.id,
								entityName: schema.entity.name,
								entityUserId: schema.entity.userId,
								entitySchemaSlug: schema.entity.entitySchemaSlug,
								entitySchemaPluginId: schema.entity.entitySchemaPluginId,
							})
							.from(schema.entity)
							.where(
								and(eq(schema.entity.id, input.entityId), entityVisibleToUserClause(input.userId)),
							)
							.limit(1),
					);

					if (!row) {
						return null;
					}

					return {
						...row,
						entityId: EntityId.make(row.entityId),
						isBuiltin: row.entitySchemaPluginId === null,
						entitySchemaSlug: EntitySchemaSlug.make(row.entitySchemaSlug),
						entityUserId: row.entityUserId ? UserId.make(row.entityUserId) : null,
					};
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

			const lockGlobalEntityProvenanceScope = Effect.fn(
				"EntitiesRepository.lockGlobalEntityProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const lockKey = stableStringify([
					"global-entities",
					input.entitySchemaPluginId,
					input.entitySchemaSlug,
					input.providerId,
				]);
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`),
				);
			});

			const countGlobalEntitiesByProvenanceScope = Effect.fn(
				"EntitiesRepository.countGlobalEntitiesByProvenanceScope",
			)(function* (input: GlobalEntityProvenanceScopeInput) {
				const [row] = yield* session.run((db) =>
					db
						.select({ count: count() })
						.from(schema.entity)
						.where(
							and(
								isNull(schema.entity.userId),
								eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
								eq(schema.entity.providerId, input.providerId),
								entitySchemaPluginWhere(input.entitySchemaPluginId),
							),
						),
				);
				return row?.count ?? 0;
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

			const insertEntity = Effect.fn("EntitiesRepository.insertEntity")(function* (
				input: InsertEntityInput,
			) {
				if (input.scope === "global") {
					const externalId = input.externalId;
					const providerId = input.providerId;
					const values = {
						id: input.id,
						userId: null,
						name: input.name,
						createdAt: input.createdAt,
						updatedAt: input.createdAt,
						properties: input.properties,
						externalId: externalId ?? null,
						providerId: providerId ?? null,
						populatedAt: input.populatedAt,
						entitySchemaSlug: input.entitySchemaSlug,
						entitySchemaPluginId: input.entitySchemaPluginId ?? null,
					};

					if (!externalId) {
						const [row] = yield* session.run((db) =>
							db.insert(schema.entity).values(values).returning(entitySelection),
						);
						if (!row) {
							return yield* new DbError({ message: "Global entity insert returned no row" });
						}
						return { wasInserted: true, entity: toListedEntity(row) };
					}

					const inserted = yield* session.run((db) =>
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing()
							.returning(entitySelection),
					);

					if (inserted[0]) {
						return { wasInserted: true, entity: toListedEntity(inserted[0]) };
					}

					const [existing] = yield* session.run((db) =>
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									isNull(schema.entity.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									providerWhere(providerId),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
								),
							)
							.limit(1)
							.for("update"),
					);

					if (!existing) {
						return yield* new DbError({ message: "Global entity insert conflict but not found" });
					}

					return { wasInserted: false, entity: toListedEntity(existing) };
				}

				const externalId = input.externalId;
				const providerId = input.providerId;
				const values = {
					id: input.id,
					name: input.name,
					userId: input.userId,
					createdAt: input.createdAt,
					updatedAt: input.createdAt,
					properties: input.properties,
					externalId: externalId ?? null,
					providerId: providerId ?? null,
					populatedAt: input.populatedAt ?? null,
					entitySchemaSlug: input.entitySchemaSlug,
					entitySchemaPluginId: input.entitySchemaPluginId ?? null,
				};

				if (externalId && providerId) {
					const rows = yield* session.run((db) =>
						db
							.insert(schema.entity)
							.values(values)
							.onConflictDoNothing()
							.returning(entitySelection),
					);

					const created = rows[0];
					if (created) {
						return { wasInserted: true, entity: toListedEntity(created) };
					}

					const [row] = yield* session.run((db) =>
						db
							.select(entitySelection)
							.from(schema.entity)
							.where(
								and(
									eq(schema.entity.userId, input.userId),
									eq(schema.entity.externalId, externalId),
									eq(schema.entity.entitySchemaSlug, input.entitySchemaSlug),
									eq(schema.entity.providerId, providerId),
									entitySchemaPluginWhere(input.entitySchemaPluginId),
								),
							)
							.limit(1)
							.for("update"),
					);

					const existing = row ? toListedEntity(row) : null;

					if (existing) {
						return { entity: existing, wasInserted: false };
					}

					return yield* new DbError({ message: "Entity insert returned no row" });
				}

				const [row] = yield* session.run((db) =>
					db.insert(schema.entity).values(values).returning(entitySelection),
				);

				if (!row) {
					return yield* new DbError({ message: "Entity insert returned no row" });
				}

				return { wasInserted: true, entity: toListedEntity(row) };
			});

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
						.set({ name: input.name, properties: input.properties, populatedAt: input.populatedAt })
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

			const deleteByIds = Effect.fn("EntitiesRepository.deleteByIds")(function* (
				ids: readonly [EntityId, ...EntityId[]],
			) {
				const rows = yield* session.run((db) =>
					db
						.delete(schema.entity)
						.where(inArray(schema.entity.id, [...ids]))
						.returning({ id: schema.entity.id }),
				);
				return rows.length;
			});

			const lockMutationKeys = Effect.fn("EntitiesRepository.lockMutationKeys")(function* (
				keys: ReadonlyArray<string>,
			) {
				for (const key of [...new Set(keys)].sort()) {
					yield* session.run((db) =>
						db.execute(
							sql`select pg_advisory_xact_lock(hashtextextended(${`entity-mutation:${key}`}, 0))`,
						),
					);
				}
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

			return {
				getById,
				deleteByIds,
				insertEntity,
				updateEntity,
				getByIdForUser,
				lockMutationKeys,
				getMutationEntity,
				lockSchemaCatalog,
				findGlobalEntityById,
				getEntityScopeForUser,
				findEntityByExternalId,
				findEntitySchemaForUser,
				listEntityReferencesByIds,
				listUserEntitiesForBackup,
				lockEntityReferencesByIds,
				getClientPageEntityForUser,
				lockUserEntityEnsureScopes,
				getEntityMergeScopeForUser,
				findGlobalEntityForRestore,
				lockProviderEntityMutations,
				listMatchCandidatesBySchema,
				findUserEntityWithoutProvenance,
				lockGlobalEntityProvenanceScope,
				listGlobalEntitiesByIdsForBackup,
				findSystemEntitySchemaByReference,
				findEntitySchemaProviderByReference,
				countGlobalEntitiesByProvenanceScope,
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
