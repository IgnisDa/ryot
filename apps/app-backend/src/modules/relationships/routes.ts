import { HttpApiBuilder } from "@effect/platform";
import { CurrentUser } from "@ryot/contract/auth-middleware";
import { AppContract } from "@ryot/contract/contract";
import { badRequest, dieOnDbError, notFound } from "@ryot/contract/errors";
import type { EntityId, EntitySchemaId } from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { DateTime, Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
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
				const runWithDb = yield* DbRunner;
				const runInTransaction = yield* TransactionRunner;
				const service = yield* RelationshipsService;
				const entitiesRepository = yield* EntitiesRepository;
				const lifecycleDispatch = yield* LifecycleDispatch;
				const schemasRepository = yield* RelationshipSchemasRepository;

				const schema = yield* runWithDb(
					schemasRepository.findById(payload.relationshipSchemaId, user.id),
				);
				if (!schema) {
					return yield* notFound("Relationship schema not found");
				}

				const [sourceScope, targetScope] = yield* Effect.all([
					runWithDb(
						entitiesRepository.getEntityScopeForUser({
							userId: user.id,
							entityId: payload.sourceEntityId,
						}),
					),
					runWithDb(
						entitiesRepository.getEntityScopeForUser({
							userId: user.id,
							entityId: payload.targetEntityId,
						}),
					),
				]);
				if (!sourceScope || !targetScope) {
					return yield* notFound("Entity not found");
				}

				yield* validateSchemaTargets(
					schema,
					sourceScope.entitySchemaId,
					targetScope.entitySchemaId,
				);

				const relationshipInput = {
					scope: "user",
					userId: user.id,
					properties: payload.properties ?? {},
					sourceEntityId: payload.sourceEntityId,
					targetEntityId: payload.targetEntityId,
					propertiesSchema: schema.propertiesSchema,
					relationshipSchemaId: payload.relationshipSchemaId,
				} as const;

				const outcome = yield* runInTransaction(
					Effect.gen(function* () {
						const created = yield* service.create(relationshipInput);
						if (created.wasInserted) {
							return { wasInserted: true as const, relationship: created };
						}

						const updated = yield* service.update(relationshipInput);
						return { wasInserted: false as const, relationship: updated };
					}),
				);

				if (outcome.wasInserted) {
					const created = outcome.relationship;
					const references = yield* runWithDb(
						entitiesRepository.listEntityReferencesByIds([
							payload.sourceEntityId,
							payload.targetEntityId,
						]),
					);
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
								relationshipSchemaSlug: schema.slug,
								relationshipSchemaId: created.relationshipSchemaId,
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
		readonly sourceEntitySchemaId: EntitySchemaId | null;
		readonly targetEntitySchemaId: EntitySchemaId | null;
	},
	sourceEntitySchemaId: EntitySchemaId,
	targetEntitySchemaId: EntitySchemaId,
) => {
	if (schema.sourceEntitySchemaId && schema.sourceEntitySchemaId !== sourceEntitySchemaId) {
		return badRequest("Relationship source entity schema does not match");
	}
	if (schema.targetEntitySchemaId && schema.targetEntitySchemaId !== targetEntitySchemaId) {
		return badRequest("Relationship target entity schema does not match");
	}
	return Effect.void;
};
