import type { CurrentUserValue } from "@ryot/contract/auth-middleware";
import { badRequest, notFound } from "@ryot/contract/errors";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import {
	TranslationStatus,
	type EntityDetail,
	type ListedEntity,
} from "@ryot/contract/modules/entities/schemas";
import type { RowItem } from "@ryot/contract/modules/query-engine/language";
import { EntityId, EntitySchemaSlug, SandboxProviderId } from "@ryot/contract/schema/brands";
import type { UserId } from "@ryot/contract/schema/brands";
import { buildEntityDetailQueryDocument } from "@ryot/query-engine/recipes/app";
import { generateId } from "better-auth";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { requireText, trimToNull } from "#lib/shared/validation";
import {
	getOptionalIsoStringField,
	getOptionalStringField,
	requireFieldValue,
	requireIsoStringField,
	requireRowsResponse,
	requireStringField,
} from "#modules/query-engine/response-helpers";
import { QueryEngineService } from "#modules/query-engine/service";

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

type ValidatedGlobalEntityItem = Omit<UpsertGlobalEntityItem, "properties"> & {
	properties: Record<string, unknown>;
};

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const partialProvenanceError = "externalId and providerId must both be provided or both be omitted";

const toMutationSnapshot = (entity: ListedEntity): EntityMutationSnapshot => ({
	id: entity.id,
	name: entity.name,
	properties: entity.properties,
	entitySchemaSlug: entity.entitySchemaSlug,
});

const toListedEntity = Effect.fn("toListedEntityFromQueryEngine")(function* (row: RowItem) {
	const providerId = yield* getOptionalStringField(row, "providerId");

	return {
		name: yield* requireStringField(row, "name"),
		createdAt: yield* requireIsoStringField(row, "createdAt"),
		updatedAt: yield* requireIsoStringField(row, "updatedAt"),
		id: EntityId.make(yield* requireStringField(row, "id")),
		externalId: yield* getOptionalStringField(row, "externalId"),
		properties: (yield* requireFieldValue(row, "properties")).value,
		populatedAt: yield* getOptionalIsoStringField(row, "populatedAt"),
		providerId: providerId ? SandboxProviderId.make(providerId) : null,
		entitySchemaSlug: EntitySchemaSlug.make(yield* requireStringField(row, "entitySchemaSlug")),
	};
});

export class EntitiesService extends Effect.Service<EntitiesService>()("EntitiesService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;
		const queryEngine = yield* QueryEngineService;
		const lifecycleDispatch = yield* LifecycleDispatch;

		const parseEntityProperties = Effect.fn("EntitiesService.parseEntityProperties")(function* (
			properties: unknown,
			propertiesSchema: Parameters<typeof parseAppSchemaProperties>[0]["propertiesSchema"],
		) {
			return yield* parseAppSchemaProperties({ kind: "Entity", properties, propertiesSchema }).pipe(
				Effect.mapError((error) => badRequest(error.message)),
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
					return yield* badRequest(partialProvenanceError);
				}
			}

			const scope = yield* input.scope === "user"
				? runWithDb(
						repository.getEntitySchemaScopeForUser({
							userId: input.userId,
							entitySchemaSlug: input.entitySchemaSlug,
						}),
					)
				: runWithDb(repository.findEntitySchemaById(input.entitySchemaSlug));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			if (
				input.scope === "user" &&
				input.externalId !== undefined &&
				input.providerId !== undefined
			) {
				const existing = yield* runWithDb(
					repository.findEntityByExternalIdForUser({
						userId: input.userId,
						externalId: input.externalId,
						entitySchemaSlug: input.entitySchemaSlug,
						providerId: input.providerId,
					}),
				);
				if (existing) {
					return existing;
				}
			}

			const name = yield* requireText(input.name, "Entity name is required");
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const occurrenceId = `occ_${generateId()}`;

			const saved = yield* runWithDb(repository.insertEntity({ ...input, name, properties }));

			if (origin && saved.wasInserted) {
				yield* lifecycleDispatch.dispatch({
					origin,
					occurrenceId,
					recordId: saved.entity.id,
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

		const createGlobal = Effect.fn("EntitiesService.createGlobal")(function* (
			input: Omit<Extract<CreateAnyEntityInput, { scope: "global" }>, "scope">,
		) {
			return yield* createEntity({ ...input, scope: "global" });
		});

		const update = Effect.fn("EntitiesService.update")(function* (input: UpdateEntityInput) {
			const scope = yield* runWithDb(repository.findEntitySchemaById(input.entitySchemaSlug));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);

			return yield* runWithDb(
				repository.updateEntity({
					properties,
					name: input.name,
					entityId: input.entityId,
					populatedAt: input.populatedAt,
				}),
			);
		});

		const upsert = Effect.fn("EntitiesService.upsert")(function* (input: UpsertEntityInput) {
			const scope = yield* runWithDb(repository.findEntitySchemaById(input.entitySchemaSlug));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const name = yield* requireText(input.name, "Entity name is required");
			const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
			const saved = yield* runWithDb(
				repository.insertEntity({
					name,
					properties,
					scope: "global",
					externalId: input.externalId,
					populatedAt: input.populatedAt,
					entitySchemaSlug: input.entitySchemaSlug,
					providerId: input.providerId,
				}),
			);
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

			const entity = yield* runWithDb(
				repository.updateEntity({
					name,
					properties,
					entityId: saved.entity.id,
					populatedAt: input.populatedAt,
				}),
			);
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
					const scope = yield* runWithDb(repository.findEntitySchemaById(input.entitySchemaSlug));
					if (!scope) {
						return yield* notFound(entitySchemaNotFoundError);
					}

					const name = yield* requireText(input.name, "Entity name is required");
					const properties = yield* parseEntityProperties(input.properties, scope.propertiesSchema);
					return { ...input, name, properties } satisfies ValidatedGlobalEntityItem;
				}),
			);

			const save = (input: ValidatedGlobalEntityItem) =>
				repository.insertEntity({ ...input, scope: "global", providerId });

			if (options?.maximumTotal === undefined) {
				return yield* Effect.forEach(validated, (input) =>
					runWithDb(save(input)).pipe(
						Effect.map((saved) => ({
							entityId: saved.entity.id,
							status: "upserted" as const,
							wasInserted: saved.wasInserted,
						})),
					),
				);
			}

			if (!Number.isInteger(options.maximumTotal) || options.maximumTotal < 0) {
				return yield* badRequest("maximumTotal must be a nonnegative integer");
			}

			const maximumTotal = options.maximumTotal;
			const runInTransaction = yield* TransactionRunner;
			return yield* runInTransaction(
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
								entitySchemaSlug,
								providerId,
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
				}),
			);
		});

		const getById = Effect.fn("EntitiesService.getById")(function* (
			user: CurrentUserValue,
			entityIdInput: EntityId,
		) {
			const trimmedEntityId = trimToNull(entityIdInput);
			if (!trimmedEntityId) {
				return yield* badRequest("Entity id is required");
			}

			const entityId = EntityId.make(trimmedEntityId);
			const scope = yield* runWithDb(
				repository.getEntityScopeForUser({ userId: user.id, entityId }),
			);
			if (!scope) {
				return yield* notFound(entityNotFoundError);
			}

			const response = yield* queryEngine.execute(
				user,
				buildEntityDetailQueryDocument({ entityId, entitySchemaSlug: scope.entitySchemaSlug }),
			);
			const rows = yield* requireRowsResponse(response);
			const row = rows.data.items[0];
			if (!row) {
				return yield* notFound(entityNotFoundError);
			}

			const entity = yield* toListedEntity(row);
			const translationStatus = yield* Schema.decodeUnknown(TranslationStatus)(
				yield* requireStringField(row, "translationStatus"),
			).pipe(Effect.orDie);

			return { ...entity, translationStatus } satisfies EntityDetail;
		});

		const getByIdAnyScope = Effect.fn("EntitiesService.getByIdAnyScope")(function* (
			entityId: EntityId,
		) {
			const entity = yield* runWithDb(repository.getById(entityId));
			if (!entity) {
				return yield* notFound(entityNotFoundError);
			}
			return entity;
		});

		const deleteByIds = Effect.fn("EntitiesService.deleteByIds")(function* (
			ids: readonly [EntityId, ...EntityId[]],
		) {
			return yield* runWithDb(repository.deleteByIds(ids));
		});

		return {
			create,
			update,
			upsert,
			getById,
			deleteByIds,
			createGlobal,
			getByIdAnyScope,
			upsertGlobalEntities,
		};
	}),
}) {}
