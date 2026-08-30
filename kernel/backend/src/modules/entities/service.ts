import type { AutomationOrigin } from "@ryot-app/contract/modules/automations/schemas";
import {
	EntityBadRequest,
	EntityNotFound,
	type ListedEntity,
} from "@ryot-app/contract/modules/entities/schemas";
import type {
	EntityId,
	EntitySchemaSlug,
	SandboxProviderId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
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
	| { scope: "global"; externalId: string; populatedAt: Date | null; providerId: SandboxProviderId }
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
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

type UpsertEntityInput = {
	name: string;
	externalId: string;
	properties: unknown;
	updateExisting: boolean;
	populatedAt: Date | null;
	providerId: SandboxProviderId;
	entitySchemaSlug: EntitySchemaSlug;
} & ({ scope: "global" } | { scope: "user"; userId: UserId });

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

type EnsuredUserEntity = { readonly entity: ListedEntity; readonly wasInserted: boolean };

type ValidatedGlobalEntityItem = Omit<UpsertGlobalEntityItem, "properties"> & {
	properties: Record<string, unknown>;
	entitySchemaPluginId: string | null;
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
			origin = input.origin,
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
				? repository.findEntitySchemaForUser({
						userId: input.userId,
						entitySchemaSlug: input.entitySchemaSlug,
					})
				: repository.findSystemEntitySchemaById(input.entitySchemaSlug);
			if (!scope) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
				});
			}

			const name = trimToNull(input.name);
			if (!name) {
				return yield* new EntityBadRequest({ reason: { code: "name-required", field: "name" } });
			}
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const saved = yield* repository.insertEntity({
				...input,
				name,
				origin,
				properties,
				entitySchemaPluginId: scope.pluginId ?? null,
			});

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
												origin: { kind: "bootstrap" },
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
			const entity =
				input.scope === "user"
					? yield* repository.getEntityScopeForUser({
							userId: input.userId,
							entityId: input.entityId,
						})
					: yield* repository.findGlobalEntityById(input.entityId);
			if (!entity) {
				return yield* new EntityNotFound({
					reason: { code: "entity-not-found", entityId: input.entityId },
				});
			}
			const entitySchema = yield* input.scope === "user"
				? repository.findEntitySchemaForUser({
						userId: input.userId,
						entitySchemaSlug: entity.entitySchemaSlug,
					})
				: repository.findSystemEntitySchemaById(entity.entitySchemaSlug);
			if (!entitySchema) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: entity.entitySchemaSlug },
				});
			}

			const properties = yield* parseEntityProperties(
				input.properties,
				entitySchema.propertiesSchema,
			);

			return yield* repository.updateEntity({
				properties,
				name: input.name,
				entityId: input.entityId,
				populatedAt: input.populatedAt,
			});
		});

		const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
			const scope = yield* input.scope === "user"
				? repository.findEntitySchemaForUser({
						userId: input.userId,
						entitySchemaSlug: input.entitySchemaSlug,
					})
				: repository.findSystemEntitySchemaById(input.entitySchemaSlug);
			if (!scope) {
				return yield* new EntityNotFound({
					reason: { code: "entity-schema-not-found", entitySchemaSlug: input.entitySchemaSlug },
				});
			}

			const name = trimToNull(input.name);
			if (!name) {
				return yield* new EntityBadRequest({ reason: { code: "name-required", field: "name" } });
			}
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const provenance = {
				externalId: input.externalId,
				providerId: input.providerId,
				entitySchemaSlug: input.entitySchemaSlug,
				...(scope.pluginId === undefined ? {} : { entitySchemaPluginId: scope.pluginId }),
			};
			const saved = yield* repository.insertEntity({
				name,
				properties,
				...provenance,
				...(input.scope === "user"
					? { scope: "user" as const, userId: input.userId }
					: { scope: "global" as const, populatedAt: input.populatedAt }),
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
					const scope = yield* repository.findSystemEntitySchemaById(input.entitySchemaSlug);
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
					return {
						...input,
						name,
						properties,
						entitySchemaPluginId: scope.pluginId ?? null,
					} satisfies ValidatedGlobalEntityItem;
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
						const scopes = [
							...new Map(
								validated.map((item) => [
									`${item.entitySchemaSlug}:${item.entitySchemaPluginId ?? "kernel"}`,
									{
										entitySchemaSlug: item.entitySchemaSlug,
										entitySchemaPluginId: item.entitySchemaPluginId,
									},
								]),
							).entries(),
						].sort(([left], [right]) => left.localeCompare(right));
						for (const [, scope] of scopes) {
							yield* repository.lockGlobalEntityProvenanceScope({ ...scope, providerId });
						}

						const counts = new Map<string, number>();
						for (const [key, scope] of scopes) {
							counts.set(
								key,
								yield* repository.countGlobalEntitiesByProvenanceScope({ ...scope, providerId }),
							);
						}

						return yield* Effect.forEach(validated, (input) =>
							Effect.gen(function* () {
								const existing = yield* repository.findEntityByExternalId({
									providerId,
									scope: "global",
									externalId: input.externalId,
									entitySchemaSlug: input.entitySchemaSlug,
									entitySchemaPluginId: input.entitySchemaPluginId,
								});
								if (existing) {
									return { wasInserted: false, entityId: existing.id, status: "upserted" as const };
								}

								const scopeKey = `${input.entitySchemaSlug}:${input.entitySchemaPluginId ?? "kernel"}`;
								const currentCount = counts.get(scopeKey) ?? 0;
								if (currentCount >= maximumTotal) {
									return { status: "skipped" as const };
								}

								const saved = yield* save(input);
								if (saved.wasInserted) {
									counts.set(scopeKey, currentCount + 1);
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
