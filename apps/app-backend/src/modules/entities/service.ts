import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	EntityBadRequest,
	EntityNotFound,
	type ListedEntity,
} from "@ryot/contract/modules/entities/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot/contract/schema/brands";
import { isObjectRecord } from "@ryot/ts-utils/predicates";
import { generateId } from "better-auth";
import { Context, DateTime, Effect, Layer } from "effect";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { trimToNull } from "#lib/shared/validation";

import { LifecycleDispatch } from "./lifecycle-dispatch";
import type { EntityMutationSnapshot } from "./mutation-outcomes";
import { EntitiesRepository, type InsertEntityInputBase } from "./repository";

type CreateEntityInput = {
	name: string;
	properties: unknown;
	origin?: AutomationOrigin;
	entitySchemaSlug: EntitySchemaSlug;
} & (
	| {
			scope: "global";
			externalId: string;
			populatedAt: Date | null;
			providerId: SandboxProviderId;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string | undefined;
			providerId?: SandboxProviderId | undefined;
	  }
);

type CreateAnyEntityInput = InsertEntityInputBase & { properties: unknown };

type UpdateEntityInput = {
	name: string;
	entityId: EntityId;
	properties: unknown;
	populatedAt: Date | null;
	entitySchemaSlug: EntitySchemaSlug;
};

type UpsertEntityInput = {
	name: string;
	externalId: string;
	properties: unknown;
	updateExisting: boolean;
	populatedAt: Date | null;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
};

export type UpsertGlobalEntityItem = {
	name: string;
	externalId: string;
	properties: unknown;
	populatedAt: Date | null;
	entitySchemaSlug: EntitySchemaSlug;
};

export type UpsertGlobalEntitiesOptions = { maximumTotal?: number };

export type EnsureUserEntityItem = {
	name: string;
	properties: unknown;
	entitySchemaSlug: EntitySchemaSlug;
};

type EnsureUserEntitiesLifecycleIdentity = {
	readonly occurredAt: string;
	readonly executionId: string;
};

type EnsuredUserEntity = {
	readonly entity: ListedEntity;
	readonly wasInserted: boolean;
};

type ValidatedGlobalEntityItem = Omit<UpsertGlobalEntityItem, "properties"> & {
	properties: Record<string, unknown>;
};

const toMutationSnapshot = (entity: ListedEntity): EntityMutationSnapshot => ({
	id: entity.id,
	name: entity.name,
	properties: entity.properties,
	entitySchemaSlug: entity.entitySchemaSlug,
});

export class EntitiesService extends Context.Service<EntitiesService>()("EntitiesService", {
	make: Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		const lifecycleDispatch = yield* LifecycleDispatch;

		const parseEntityProperties = Effect.fn("EntitiesService.parseEntityProperties")(function* (
			properties: unknown,
			propertiesSchema: Parameters<typeof parseAppSchemaProperties>[0]["propertiesSchema"],
		) {
			return yield* parseAppSchemaProperties({ kind: "Entity", properties, propertiesSchema }).pipe(
				Effect.mapError(
					(error) =>
						new EntityBadRequest({
							reason: { code: "invalid-properties", paths: error.issues.map(({ path }) => path) },
						}),
				),
			);
		});

		const createEntity = Effect.fn("EntitiesService.createEntity")(function* (
			input: CreateAnyEntityInput,
			origin?: AutomationOrigin,
		) {
			if (input.scope === "user") {
				const hasExternalId = input.externalId !== undefined;
				const hasProviderId = input.providerId !== undefined;
				if (hasExternalId !== hasProviderId) {
					return yield* new EntityBadRequest({
						reason: { code: "incomplete-provenance", fields: ["externalId", "providerId"] },
					});
				}
			}

			const scope = yield* input.scope === "user"
				? repository.getEntitySchemaScopeForUser({
						userId: input.userId,
						entitySchemaSlug: input.entitySchemaSlug,
					})
				: repository.findEntitySchemaById(input.entitySchemaSlug);
			if (!scope) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
				});
			}

			if (
				input.scope === "user" &&
				input.externalId !== undefined &&
				input.providerId !== undefined
			) {
				const existing = yield* repository.findEntityByExternalIdForUser({
					userId: input.userId,
					externalId: input.externalId,
					providerId: input.providerId,
					entitySchemaSlug: input.entitySchemaSlug,
				});
				if (existing) {
					return existing;
				}
			}

			const name = trimToNull(input.name);
			if (!name) {
				return yield* new EntityBadRequest({ reason: { code: "name-required", field: "name" } });
			}
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const saved = yield* repository.insertEntity({ ...input, name, properties });

			if (origin && saved.wasInserted) {
				yield* lifecycleDispatch.dispatch({
					origin,
					recordId: saved.entity.id,
					occurrenceId: `occ_${generateId()}`,
					occurredAt: (yield* DateTime.nowAsDate).toISOString(),
					rowUserId: input.scope === "user" ? input.userId : null,
					source: {
						kind: "entity",
						after: {
							properties,
							id: saved.entity.id,
							name: saved.entity.name,
							entitySchemaSlug: saved.entity.entitySchemaSlug,
						},
					},
				});
			}

			return saved.entity;
		});

		const create = Effect.fn("EntitiesService.create")(function* (input: CreateEntityInput) {
			return yield* createEntity(input, input.origin);
		});

		const ensureUserEntities = Effect.fn("EntitiesService.ensureUserEntities")(function* (
			userId: UserId,
			items: ReadonlyArray<EnsureUserEntityItem>,
			lifecycleIdentity?: EnsureUserEntitiesLifecycleIdentity,
		) {
			const database = yield* Database;
			const saved = yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						yield* repository.lockUserEntityEnsureScopes({
							userId,
							entitySchemaSlugs: items.map(({ entitySchemaSlug }) => entitySchemaSlug),
						});
						return yield* Effect.forEach(items, (item) =>
							repository
								.findUserEntityWithoutProvenance({
									userId,
									entitySchemaSlug: item.entitySchemaSlug,
								})
								.pipe(
									Effect.flatMap((existing) =>
										Effect.gen(function* () {
											if (existing) {
												return { entity: existing, wasInserted: false } satisfies EnsuredUserEntity;
											}
											const entity = yield* createEntity({
												userId,
												scope: "user",
												name: item.name,
												properties: item.properties,
												entitySchemaSlug: item.entitySchemaSlug,
											});
											return { entity, wasInserted: true } satisfies EnsuredUserEntity;
										}),
									),
								),
						);
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
			const occurredAt = lifecycleIdentity?.occurredAt ?? (yield* DateTime.nowAsDate).toISOString();
			yield* Effect.forEach(
				saved,
				({ entity, wasInserted }, index) =>
					wasInserted
						? lifecycleDispatch.dispatch({
								occurredAt,
								rowUserId: userId,
								recordId: entity.id,
								origin: { kind: "bootstrap" },
								occurrenceId: lifecycleIdentity
									? `${lifecycleIdentity.executionId}-ensure-user-entity-${index}`
									: `occ_${generateId()}`,
								source: {
									kind: "entity",
									after: {
										...toMutationSnapshot(entity),
										properties: isObjectRecord(entity.properties) ? entity.properties : {},
									},
								},
							})
						: Effect.void,
				{ discard: true },
			);
			return saved.map(({ entity, wasInserted }) => ({ entityId: entity.id, wasInserted }));
		});

		const createGlobal = Effect.fn("EntitiesService.createGlobal")(function* (
			input: Omit<Extract<CreateAnyEntityInput, { scope: "global" }>, "scope">,
		) {
			return yield* createEntity({ ...input, scope: "global" });
		});

		const update = Effect.fn("EntitiesService.update")(function* (input: UpdateEntityInput) {
			const scope = yield* repository.findEntitySchemaById(input.entitySchemaSlug);
			if (!scope) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
				});
			}

			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);

			return yield* repository.updateEntity({
				properties,
				name: input.name,
				entityId: input.entityId,
				populatedAt: input.populatedAt,
			});
		});

		const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
			const scope = yield* repository.findEntitySchemaById(input.entitySchemaSlug);
			if (!scope) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
				});
			}

			const name = trimToNull(input.name);
			if (!name) {
				return yield* new EntityBadRequest({
					reason: { code: "name-required", field: "name" },
				});
			}
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const saved = yield* repository.insertEntity({
				name,
				properties,
				scope: "global",
				externalId: input.externalId,
				providerId: input.providerId,
				populatedAt: input.populatedAt,
				entitySchemaSlug: input.entitySchemaSlug,
			});
			const before = toMutationSnapshot(saved.entity);

			if (saved.wasInserted) {
				return {
					entity: saved.entity,
					outcome: { before: null, after: before, operation: "create" as const },
				};
			}

			if (!input.updateExisting && saved.entity.populatedAt !== null) {
				return {
					entity: saved.entity,
					outcome: { before, after: before, operation: "noop" as const },
				};
			}

			const entity = yield* repository.updateEntity({
				name,
				properties,
				entityId: saved.entity.id,
				populatedAt: input.populatedAt,
			});
			const after = toMutationSnapshot(entity);
			const operation =
				before.name === after.name && Bun.deepEquals(before.properties, after.properties)
					? ("noop" as const)
					: ("update" as const);

			return { entity, outcome: { before, after, operation } };
		});

		const upsertGlobalEntities = Effect.fn("EntitiesService.upsertGlobalEntities")(function* (
			items: ReadonlyArray<UpsertGlobalEntityItem>,
			providerId: SandboxProviderId,
			options?: UpsertGlobalEntitiesOptions,
		) {
			const validated = yield* Effect.forEach(items, (input) =>
				Effect.gen(function* () {
					const scope = yield* repository.findEntitySchemaById(input.entitySchemaSlug);
					if (!scope) {
						return yield* new EntityNotFound({
							reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
						});
					}

					const name = trimToNull(input.name);
					if (!name) {
						return yield* new EntityBadRequest({
							reason: { code: "name-required", field: "name" },
						});
					}
					const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
					return { ...input, name, properties } satisfies ValidatedGlobalEntityItem;
				}),
			);

			const save = (input: ValidatedGlobalEntityItem) =>
				repository.insertEntity({ ...input, scope: "global", providerId });

			if (options?.maximumTotal === undefined) {
				return yield* Effect.forEach(validated, (input) =>
					save(input).pipe(
						Effect.map((saved) => ({
							entityId: saved.entity.id,
							status: "upserted" as const,
							wasInserted: saved.wasInserted,
						})),
					),
				);
			}

			if (!Number.isInteger(options.maximumTotal) || options.maximumTotal < 0) {
				return yield* new EntityBadRequest({
					reason: { code: "invalid-maximum-total", field: "maximumTotal" },
				});
			}

			const maximumTotal = options.maximumTotal;
			const database = yield* Database;
			return yield* mapDatabaseErrors(
				database.transaction((transaction) =>
					Effect.gen(function* () {
						const scopeSlugs = [...new Set(validated.map((item) => item.entitySchemaSlug))].sort();
						for (const entitySchemaSlug of scopeSlugs) {
							yield* repository.lockGlobalEntityProvenanceScope({
								entitySchemaSlug,
								providerId,
							});
						}

						const counts = new Map<EntitySchemaSlug, number>();
						for (const entitySchemaSlug of scopeSlugs) {
							counts.set(
								entitySchemaSlug,
								yield* repository.countGlobalEntitiesByProvenanceScope({
									providerId,
									entitySchemaSlug,
								}),
							);
						}

						return yield* Effect.forEach(validated, (input) =>
							Effect.gen(function* () {
								const existing = yield* repository.findGlobalEntityByExternalId({
									providerId,
									externalId: input.externalId,
									entitySchemaSlug: input.entitySchemaSlug,
								});
								if (existing) {
									return { wasInserted: false, entityId: existing.id, status: "upserted" as const };
								}

								const currentCount = counts.get(input.entitySchemaSlug) ?? 0;
								if (currentCount >= maximumTotal) {
									return { status: "skipped" as const };
								}

								const saved = yield* save(input);
								if (saved.wasInserted) {
									counts.set(input.entitySchemaSlug, currentCount + 1);
								}
								return {
									entityId: saved.entity.id,
									status: "upserted" as const,
									wasInserted: saved.wasInserted,
								};
							}),
						);
					}).pipe(Effect.provideService(Database, transaction)),
				),
			);
		});

		const getByIdAnyScope = Effect.fn("EntitiesService.getByIdAnyScope")(function* (
			entityId: EntityId,
		) {
			const entity = yield* repository.getById(entityId);
			if (!entity) {
				return yield* new EntityNotFound({ reason: { code: "entity-not-found", entityId } });
			}
			return entity;
		});

		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
			ids: readonly [EntityId, ...EntityId[]],
		) {
			return yield* repository.deleteByIds(ids);
		});

		return {
			create,
			update,
			upsert,
			deleteByIds,
			createGlobal,
			getByIdAnyScope,
			ensureUserEntities,
			upsertGlobalEntities,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
