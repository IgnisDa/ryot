import { badRequest, notFound } from "@ryot/contract/errors";
import type { EntityId, RelationshipSchemaSlug, UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { parseAppSchemaProperties } from "#lib/property-schema/property-schema-runtime";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";

import {
	RelationshipsRepository,
	type GlobalRelationshipListInput,
	type RelationshipIdentityInput,
} from "./repository";

type CreateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

type UpdateRelationshipInput = RelationshipIdentityInput & {
	properties: unknown;
	propertiesSchema: AppSchema;
};

type UserRelationshipIdentity = {
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

const relationshipKey = (input: { sourceEntityId: EntityId; targetEntityId: EntityId }) =>
	`${input.sourceEntityId}\u0000${input.targetEntityId}`;

export const changeUserRelationships = Effect.fn("RelationshipsService.changeUser")(function* (
	userId: UserId,
	batches: ReadonlyArray<ChangeUserRelationshipBatch>,
) {
	const entities = yield* EntitiesRepository;
	const definitions = yield* DefinitionRegistry;
	const repository = yield* RelationshipsRepository;
	const runInTransaction = yield* TransactionRunner;

	const validate = Effect.fn("RelationshipsService.validateUserChange")(function* (
		change: UserRelationshipIdentity,
	) {
		const definition = definitions.getRelationshipSchema(change.relationshipSchemaSlug);
		if (!definition) {
			return yield* notFound("Relationship schema not found");
		}
		const [source, target] = yield* Effect.all([
			entities.getEntityScopeForUser({ userId, entityId: change.sourceEntityId }),
			entities.getEntityScopeForUser({ userId, entityId: change.targetEntityId }),
		]);
		if (!source || !target) {
			return yield* notFound("Entity not found");
		}
		if (
			definition.sourceEntitySchemaSlug &&
			definition.sourceEntitySchemaSlug !== source.entitySchemaSlug
		) {
			return yield* badRequest("Relationship source entity schema does not match");
		}
		if (
			definition.targetEntitySchemaSlug &&
			definition.targetEntitySchemaSlug !== target.entitySchemaSlug
		) {
			return yield* badRequest("Relationship target entity schema does not match");
		}
		return definition;
	});

	return yield* Effect.forEach(batches, (batch) =>
		runInTransaction(
			Effect.gen(function* () {
				let created = 0;
				let deleted = 0;
				for (const create of batch.creates) {
					const definition = yield* validate(create);
					const properties = yield* parseAppSchemaProperties({
						kind: "Relationship",
						properties: create.properties,
						propertiesSchema: definition.propertiesSchema,
					}).pipe(Effect.mapError((error) => badRequest(error.message)));
					const saved = yield* repository.createRelationship({
						...create,
						properties,
						userId,
						scope: "user",
					});
					if (saved.wasInserted) {
						created += 1;
					}
				}
				for (const remove of batch.deletes) {
					yield* validate(remove);
					const removed = yield* repository.deleteRelationship({
						...remove,
						userId,
						scope: "user",
					});
					if (removed) {
						deleted += 1;
					}
				}
				return { created, deleted };
			}),
		),
	);
});

export const reconcileGlobalRelationships = Effect.fn("RelationshipsService.reconcileGlobal")(
	function* (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>) {
		const runInTransaction = yield* TransactionRunner;
		const definitions = yield* DefinitionRegistry;
		const repository = yield* RelationshipsRepository;

		return yield* Effect.forEach(groups, (group) =>
			runInTransaction(
				Effect.gen(function* () {
					const propertiesSchema = definitions.getRelationshipSchema(
						group.relationshipSchemaSlug,
					)?.propertiesSchema;
					if (!propertiesSchema) {
						return yield* notFound("Relationship schema not found");
					}

					const selector = {
						...group.selector,
						relationshipSchemaSlug: group.relationshipSchemaSlug,
					} as GlobalRelationshipListInput;
					const existing = yield* repository.listGlobalRelationships(selector);
					const seen = new Set<string>();
					const relationships = yield* Effect.forEach(group.relationships, (relationship) =>
						Effect.gen(function* () {
							let matchesSelector = relationship.sourceEntityId === relationship.targetEntityId;
							if (group.selector.type === "anchored") {
								matchesSelector =
									group.selector.direction === "outgoing"
										? relationship.sourceEntityId === group.selector.anchorEntityId
										: relationship.targetEntityId === group.selector.anchorEntityId;
							}
							if (!matchesSelector) {
								return yield* badRequest("Relationship does not match its reconciliation selector");
							}

							const key = relationshipKey(relationship);
							if (seen.has(key)) {
								return yield* badRequest("Reconciliation group contains duplicate relationships");
							}
							seen.add(key);

							const properties = yield* parseAppSchemaProperties({
								propertiesSchema,
								kind: "Relationship",
								properties: relationship.properties,
							}).pipe(Effect.mapError((error) => badRequest(error.message)));
							return { ...relationship, properties };
						}),
					);

					for (const relationship of relationships) {
						const input = {
							...relationship,
							scope: "global" as const,
							relationshipSchemaSlug: group.relationshipSchemaSlug,
						};
						const saved = yield* repository.createRelationship(input);
						if (!saved.wasInserted) {
							yield* repository.updateRelationship(input);
						}
					}

					let deleted = 0;
					for (const relationship of existing) {
						if (seen.has(relationshipKey(relationship))) {
							continue;
						}
						const removed = yield* repository.deleteRelationship({
							scope: "global",
							sourceEntityId: relationship.sourceEntityId,
							targetEntityId: relationship.targetEntityId,
							relationshipSchemaSlug: group.relationshipSchemaSlug,
						});
						if (removed) {
							deleted += 1;
						}
					}

					return { deleted, upserted: relationships.length };
				}),
			),
		);
	},
);

export class RelationshipsService extends Effect.Service<RelationshipsService>()(
	"RelationshipsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const repository = yield* RelationshipsRepository;

			const parseProperties = Effect.fn("RelationshipsService.parseProperties")(function* (input: {
				properties: unknown;
				propertiesSchema: AppSchema;
			}) {
				return yield* parseAppSchemaProperties({
					kind: "Relationship",
					properties: input.properties,
					propertiesSchema: input.propertiesSchema,
				}).pipe(Effect.mapError((error) => badRequest(error.message)));
			});

			const create = Effect.fn("RelationshipsService.create")(function* (
				input: CreateRelationshipInput,
			) {
				const { propertiesSchema, ...saveInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});

				return yield* runWithDb(repository.createRelationship({ ...saveInput, properties }));
			});

			const update = Effect.fn("RelationshipsService.update")(function* (
				input: UpdateRelationshipInput,
			) {
				const { propertiesSchema, ...updateInput } = input;
				const properties = yield* parseProperties({
					propertiesSchema,
					properties: input.properties,
				});
				const updated = yield* runWithDb(
					repository.updateRelationship({ ...updateInput, properties }),
				);
				if (!updated) {
					return yield* notFound("Relationship not found");
				}
				return updated;
			});

			const deleteRelationship = Effect.fn("RelationshipsService.delete")(function* (
				input: RelationshipIdentityInput,
			) {
				return yield* runWithDb(repository.deleteRelationship(input));
			});

			const listGlobal = Effect.fn("RelationshipsService.listGlobal")(function* (
				input: GlobalRelationshipListInput,
			) {
				return yield* runWithDb(repository.listGlobalRelationships(input));
			});

			return {
				create,
				update,
				listGlobal,
				delete: deleteRelationship,
				changeUser: (userId: UserId, batches: ReadonlyArray<ChangeUserRelationshipBatch>) =>
					changeUserRelationships(userId, batches).pipe(
						Effect.provideService(RelationshipsRepository, repository),
					),
				reconcileGlobal: (groups: ReadonlyArray<ReconcileGlobalRelationshipGroup>) =>
					reconcileGlobalRelationships(groups).pipe(
						Effect.provideService(RelationshipsRepository, repository),
					),
			};
		}),
	},
) {}
