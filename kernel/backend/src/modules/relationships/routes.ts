import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { dieOnDbError } from "@ryot/contract/errors";
import {
	RelationshipBadRequest,
	RelationshipNotFound,
} from "@ryot/contract/modules/relationships/schemas";
import type { EntityId, EntitySchemaSlug } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { LifecycleDispatch } from "#modules/entities/lifecycle-dispatch";
import type { LifecycleEntityReference } from "#modules/entities/lifecycle-dispatch";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipSchemasRepository } from "#modules/relationship-schemas/repository";

import { RelationshipsService } from "./service";

export const RelationshipsRoutesLive = HttpApiBuilder.group(
	AppContract,
	"relationships",
	(handlers) =>
		handlers.handle("create", ({ payload }) =>
			Effect.gen(function* () {
				const user = yield* CurrentUser;
				const database = yield* Database;
				const service = yield* RelationshipsService;
				const entitiesRepository = yield* EntitiesRepository;
				const lifecycleDispatch = yield* LifecycleDispatch;
				const schemasRepository = yield* RelationshipSchemasRepository;

				const schema = yield* schemasRepository.findById(payload.relationshipSchemaSlug, user.id);
				if (!schema) {
					return yield* new RelationshipNotFound({
						reason: {
							code: "relationship-schema-not-found",
							relationshipSchemaSlug: payload.relationshipSchemaSlug,
						},
					});
				}

				const [sourceScope, targetScope] = yield* Effect.all([
					entitiesRepository.getEntityScopeForUser({
						userId: user.id,
						entityId: payload.sourceEntityId,
					}),
					entitiesRepository.getEntityScopeForUser({
						userId: user.id,
						entityId: payload.targetEntityId,
					}),
				]);
				if (!sourceScope || !targetScope) {
					return yield* new RelationshipNotFound({
						reason: {
							code: "entity-not-found",
							entityIds: [payload.sourceEntityId, payload.targetEntityId],
						},
					});
				}

				yield* validateSchemaTargets(
					schema,
					sourceScope.entitySchemaSlug,
					targetScope.entitySchemaSlug,
				);

				const relationshipInput = {
					scope: "user",
					userId: user.id,
					properties: payload.properties ?? {},
					sourceEntityId: payload.sourceEntityId,
					targetEntityId: payload.targetEntityId,
					propertiesSchema: schema.propertiesSchema,
					relationshipSchemaSlug: payload.relationshipSchemaSlug,
					relationshipSchemaPluginId: schema.pluginId ?? null,
				} as const;

				const outcome = yield* mapDatabaseErrors(
					database.transaction((transaction) =>
						Effect.gen(function* () {
							const created = yield* service.create(relationshipInput);
							if (created.wasInserted) {
								return { wasInserted: true as const, relationship: created };
							}

							const updated = yield* service.update(relationshipInput);
							return { wasInserted: false as const, relationship: updated };
						}).pipe(Effect.provideService(Database, transaction)),
					),
				);

				if (outcome.wasInserted) {
					const created = outcome.relationship;
					const references = yield* entitiesRepository.listEntityReferencesByIds([
						payload.sourceEntityId,
						payload.targetEntityId,
					]);
					const referenceFor = (entityId: EntityId): LifecycleEntityReference =>
						references.find((candidate) => candidate.id === entityId) ?? {
							name: "",
							id: entityId,
							entitySchemaSlug: "",
						};
					yield* lifecycleDispatch.dispatch({
						rowUserId: user.id,
						recordId: created.id,
						origin: { kind: "api" },
						occurrenceId: `occ_${generateId()}`,
						occurredAt: (yield* DateTime.nowAsDate).toISOString(),
						source: {
							kind: "relationship",
							after: {
								id: created.id,
								properties: created.properties,
								relationshipSchemaSlug: created.relationshipSchemaSlug,
								target: referenceFor(payload.targetEntityId),
								source: referenceFor(payload.sourceEntityId),
							},
						},
					});
				}

				return outcome.relationship;
			}).pipe(dieOnDbError),
		),
);

const validateSchemaTargets = (
	schema: {
		readonly sourceEntitySchemaSlug: EntitySchemaSlug | null;
		readonly targetEntitySchemaSlug: EntitySchemaSlug | null;
	},
	sourceEntitySchemaSlug: EntitySchemaSlug,
	targetEntitySchemaSlug: EntitySchemaSlug,
) => {
	if (schema.sourceEntitySchemaSlug && schema.sourceEntitySchemaSlug !== sourceEntitySchemaSlug) {
		return new RelationshipBadRequest({
			reason: {
				code: "source-schema-mismatch",
				actual: sourceEntitySchemaSlug,
				expected: schema.sourceEntitySchemaSlug,
			},
		});
	}
	if (schema.targetEntitySchemaSlug && schema.targetEntitySchemaSlug !== targetEntitySchemaSlug) {
		return new RelationshipBadRequest({
			reason: {
				code: "target-schema-mismatch",
				actual: targetEntitySchemaSlug,
				expected: schema.targetEntitySchemaSlug,
			},
		});
	}
	return Effect.void;
};
