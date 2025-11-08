import { Effect } from "effect";

import type { CurrentUserValue } from "#lib/auth-middleware";
import { DbRunner } from "#lib/db";
import { badRequest, notFound } from "#lib/errors";
import { EntityId, EntitySchemaId, SandboxScriptId, type UserId } from "#lib/schema/brands";
import { parseAppSchemaProperties } from "#lib/schema/property-schema-runtime";
import { requireText, trimToNull } from "#lib/validation";

import { EntitiesRepository } from "./repository";
import type { CreateEntityBody } from "./schemas";
import type { StoredEntityImage } from "./types";

type SaveEntityInput = {
	name: string;
	properties: unknown;
	entitySchemaId: EntitySchemaId;
	image: StoredEntityImage | null;
} & (
	| {
			scope: "global";
			externalId: string;
			populatedAt: Date | null;
			sandboxScriptId: SandboxScriptId;
	  }
	| {
			scope: "user";
			userId: UserId;
			externalId?: string;
			sandboxScriptId?: SandboxScriptId;
	  }
);

const entityNotFoundError = "Entity not found";
const entitySchemaNotFoundError = "Entity schema not found";
const partialProvenanceError =
	"externalId and sandboxScriptId must both be provided or both be omitted";

export class EntitiesService extends Effect.Service<EntitiesService>()("EntitiesService", {
	effect: Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* EntitiesRepository;

		const save = Effect.fn("EntitiesService.save")(function* (input: SaveEntityInput) {
			if (input.scope === "user") {
				const hasExternalId = input.externalId !== undefined;
				const hasScriptId = input.sandboxScriptId !== undefined;
				if (hasExternalId !== hasScriptId) {
					return yield* badRequest(partialProvenanceError);
				}
			}

			const scope = yield* input.scope === "user"
				? runWithDb(
						repository.getEntitySchemaScopeForUser({
							userId: input.userId,
							entitySchemaId: input.entitySchemaId,
						}),
					)
				: runWithDb(repository.findEntitySchemaById(input.entitySchemaId));
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const properties = yield* parseAppSchemaProperties({
				kind: "Entity",
				properties: input.properties,
				propertiesSchema: scope.propertiesSchema,
			}).pipe(Effect.mapError((error) => badRequest(error.message)));

			return yield* runWithDb(repository.saveEntity({ ...input, properties }));
		});

		const create = Effect.fn("EntitiesService.create")(function* (
			user: CurrentUserValue,
			payload: CreateEntityBody,
		) {
			const externalId = payload.externalId ? trimToNull(payload.externalId) : null;
			const trimmedScriptId = payload.sandboxScriptId ? trimToNull(payload.sandboxScriptId) : null;
			const sandboxScriptId = trimmedScriptId ? SandboxScriptId.make(trimmedScriptId) : null;
			const hasExternalId = externalId !== null;
			const hasScriptId = sandboxScriptId !== null;
			if (hasExternalId !== hasScriptId) {
				return yield* badRequest(partialProvenanceError);
			}

			const trimmedEntitySchemaId = trimToNull(payload.entitySchemaId);
			if (!trimmedEntitySchemaId) {
				return yield* badRequest("Entity schema id is required");
			}

			const entitySchemaId = EntitySchemaId.make(trimmedEntitySchemaId);
			const scope = yield* runWithDb(
				repository.getEntitySchemaScopeForUser({ userId: user.id, entitySchemaId }),
			);
			if (!scope) {
				return yield* notFound(entitySchemaNotFoundError);
			}

			const provenance = externalId && sandboxScriptId ? { externalId, sandboxScriptId } : null;

			if (provenance) {
				const existing = yield* runWithDb(
					repository.findEntityByExternalIdForUser({
						entitySchemaId,
						userId: user.id,
						externalId: provenance.externalId,
						sandboxScriptId: provenance.sandboxScriptId,
					}),
				);
				if (existing) {
					return existing;
				}
			}

			const name = yield* requireText(payload.name, "Entity name is required");

			return yield* save({
				name,
				scope: "user",
				entitySchemaId,
				userId: user.id,
				image: payload.image ?? null,
				properties: payload.properties,
				...provenance,
			});
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

			const entity = yield* runWithDb(repository.getByIdForUser({ userId: user.id, entityId }));
			if (!entity) {
				return yield* notFound(entityNotFoundError);
			}

			return entity;
		});

		return { save, create, getById };
	}),
}) {}
