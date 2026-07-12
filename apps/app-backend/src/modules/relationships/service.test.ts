import { expect, it } from "@effect/vitest";
import { BadRequest, NotFound } from "@ryot/contract/errors";
import {
	EntityId,
	EntitySchemaSlug,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
import { Cause, Effect, Exit, Layer } from "effect";

import { CurrentDb, TransactionRunner } from "#lib/infrastructure/db/service";
import { assertExitFails } from "#lib/test-utils/assertions";
import type { MockOverrides } from "#lib/test-utils/effect";
import { dbRunnerLayer } from "#lib/test-utils/effect";
import { DefinitionRegistry, makeDefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";

import { RelationshipsRepository } from "./repository";
import { RelationshipsService } from "./service";

const userId = UserId.make("user-id");
const sourceEntityId = EntityId.make("source-entity-id");
const targetEntityId = EntityId.make("target-entity-id");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("rel-schema-id");
const monitoringRelationshipSchemaSlug = RelationshipSchemaSlug.make("monitoring-rel-schema-id");

const relationship = {
	properties: {},
	sourceEntityId,
	targetEntityId,
	wasInserted: true,
	relationshipSchemaSlug,
	id: RelationshipId.make("rel-id"),
	createdAt: "2026-06-22T00:00:00.000Z",
};

const mockRelationshipsRepository = Layer.mock(RelationshipsRepository);
type GetEntityScopeForUser = (input: { userId: UserId; entityId: EntityId }) => Effect.Effect<{
	entityId: EntityId;
	isBuiltin: boolean;
	entityName: string;
	entityUserId: UserId | null;
	entitySchemaSlug: EntitySchemaSlug;
} | null>;

const makeRelationshipsRepository = (
	overrides: MockOverrides<typeof mockRelationshipsRepository> = {},
) =>
	mockRelationshipsRepository({
		...overrides,
		_tag: "RelationshipsRepository",
	});

const makeServiceLayer = (
	overrides: Parameters<typeof makeRelationshipsRepository>[0] = {},
	runInTransaction: TransactionRunner["Type"] = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.provideService(effect, CurrentDb, Object.create(null)),
	getEntityScopeForUser: GetEntityScopeForUser = ({ entityId }) =>
		Effect.succeed({
			entityId,
			isBuiltin: true,
			entityUserId: null,
			entityName: "Entity",
			entitySchemaSlug: EntitySchemaSlug.make("entity"),
		}),
) =>
	Layer.provideMerge(
		RelationshipsService.Default,
		Layer.mergeAll(
			dbRunnerLayer,
			makeRelationshipsRepository(overrides),
			Layer.mock(EntitiesRepository)({
				_tag: "EntitiesRepository",
				getEntityScopeForUser,
			}),
			Layer.succeed(TransactionRunner, runInTransaction),
			Layer.succeed(DefinitionRegistry, {
				_tag: "DefinitionRegistry",
				...makeDefinitionRegistry(),
				getRelationshipSchema: () => ({
					name: "Relationship",
					slug: "rel-schema-id",
					sourceEntitySchemaSlug: null,
					targetEntitySchemaSlug: null,
					propertiesSchema: { fields: {} },
				}),
			}),
		),
	);

const baseInput = {
	userId,
	properties: {},
	sourceEntityId,
	targetEntityId,
	relationshipSchemaSlug,
	scope: "user" as const,
	propertiesSchema: { fields: {} } as const,
};

it.effect("returns bad request when create properties violate the relationship schema", () => {
	const layer = makeServiceLayer();

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(
			service.create({
				...baseInput,
				properties: { status: "deleted" },
				propertiesSchema: {
					fields: {
						status: {
							label: "Status",
							type: "enum" as const,
							description: "Status",
							options: ["active", "inactive"],
						},
					},
				},
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const failure = Cause.failureOption(exit.cause);
			expect(failure._tag).toBe("Some");
			if (failure._tag === "Some") {
				expect(failure.value).toBeInstanceOf(BadRequest);
			}
		}
	}).pipe(Effect.provide(layer));
});

it.effect("creates a validated user relationship", () => {
	let createdInput: unknown;
	const layer = makeServiceLayer({
		createRelationship: (input) =>
			Effect.sync(() => {
				createdInput = input;
				return relationship;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.create(baseInput);
		expect(result).toEqual(relationship);
		expect(createdInput).toEqual({
			userId,
			properties: {},
			sourceEntityId,
			targetEntityId,
			relationshipSchemaSlug,
			scope: "user",
		});
	}).pipe(Effect.provide(layer));
});

it.effect("updates a validated global relationship", () => {
	let updatedInput: unknown;
	const updated = { ...relationship, wasInserted: false };
	const layer = makeServiceLayer({
		updateRelationship: (input) =>
			Effect.sync(() => {
				updatedInput = input;
				return updated;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.update({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaSlug,
			propertiesSchema: { fields: {} },
		});
		expect(result).toEqual(updated);
		expect(updatedInput).toEqual({
			properties: {},
			sourceEntityId,
			targetEntityId,
			scope: "global",
			relationshipSchemaSlug,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("returns not found when updating a missing relationship", () => {
	const layer = makeServiceLayer({ updateRelationship: () => Effect.succeed(null) });

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(service.update({ ...baseInput }));
		assertExitFails(exit, new NotFound({ message: "Relationship not found" }));
	}).pipe(Effect.provide(layer));
});

it.effect("deletes one relationship through the repository", () => {
	let deletedInput: unknown;
	const layer = makeServiceLayer({
		deleteRelationship: (input) =>
			Effect.sync(() => {
				deletedInput = input;
				return relationship;
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.delete({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaSlug,
		});
		expect(result).toEqual(relationship);
		expect(deletedInput).toEqual({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaSlug,
		});
	}).pipe(Effect.provide(layer));
});

it.effect("atomically ensures and deletes generic user relationship batches", () => {
	const created: unknown[] = [];
	const deleted: unknown[] = [];
	const transactionDatabases: unknown[] = [];
	const monitoringEntityId = EntityId.make("monitoring-entity-id");
	const libraryEntityId = EntityId.make("library-entity-id");
	const layer = makeServiceLayer(
		{
			createRelationship: (input) =>
				Effect.gen(function* () {
					transactionDatabases.push(yield* CurrentDb);
					created.push(input);
					return { ...relationship, ...input };
				}),
			deleteRelationship: (input) =>
				Effect.gen(function* () {
					transactionDatabases.push(yield* CurrentDb);
					deleted.push(input);
					return { ...relationship, ...input };
				}),
		},
		(effect) => Effect.provideService(effect, CurrentDb, Object.create(null)),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.changeUser(userId, [
			{
				deletes: [],
				creates: [
					{
						properties: {},
						sourceEntityId,
						targetEntityId: libraryEntityId,
						relationshipSchemaSlug,
					},
					{
						properties: {},
						sourceEntityId,
						targetEntityId: monitoringEntityId,
						relationshipSchemaSlug: monitoringRelationshipSchemaSlug,
					},
				],
			},
			{
				creates: [],
				deletes: [
					{
						sourceEntityId,
						targetEntityId: monitoringEntityId,
						relationshipSchemaSlug: monitoringRelationshipSchemaSlug,
					},
				],
			},
		]);

		expect(result).toEqual([
			{ created: 2, deleted: 0 },
			{ created: 0, deleted: 1 },
		]);
		expect(created).toHaveLength(2);
		expect(deleted).toEqual([
			{
				userId,
				scope: "user",
				sourceEntityId,
				targetEntityId: monitoringEntityId,
				relationshipSchemaSlug: monitoringRelationshipSchemaSlug,
			},
		]);
		expect(transactionDatabases).toHaveLength(3);
		expect(transactionDatabases[0]).toBe(transactionDatabases[1]);
		expect(transactionDatabases[1]).not.toBe(transactionDatabases[2]);
	}).pipe(Effect.provide(layer));
});

it.effect("treats existing creates and missing deletes as successful no-ops", () => {
	const transactionDatabases: unknown[] = [];
	const layer = makeServiceLayer(
		{
			createRelationship: () =>
				Effect.gen(function* () {
					transactionDatabases.push(yield* CurrentDb);
					return { ...relationship, wasInserted: false };
				}),
			deleteRelationship: () =>
				Effect.gen(function* () {
					transactionDatabases.push(yield* CurrentDb);
					return null;
				}),
		},
		(effect) => Effect.provideService(effect, CurrentDb, Object.create(null)),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const [result] = yield* service.changeUser(userId, [
			{
				creates: [{ properties: {}, sourceEntityId, targetEntityId, relationshipSchemaSlug }],
				deletes: [{ sourceEntityId, targetEntityId, relationshipSchemaSlug }],
			},
		]);

		expect(result).toEqual({ created: 0, deleted: 0 });
		expect(transactionDatabases).toHaveLength(2);
		expect(transactionDatabases[0]).toBe(transactionDatabases[1]);
	}).pipe(Effect.provide(layer));
});

it.effect("rejects relationships to entities outside the user's visibility scope", () => {
	let writes = 0;
	const layer = makeServiceLayer(
		{
			createRelationship: () => {
				writes += 1;
				return Effect.succeed(relationship);
			},
		},
		undefined,
		() => Effect.succeed(null),
	);

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const exit = yield* Effect.exit(
			service.changeUser(userId, [
				{
					deletes: [],
					creates: [{ properties: {}, sourceEntityId, targetEntityId, relationshipSchemaSlug }],
				},
			]),
		);

		assertExitFails(exit, new NotFound({ message: "Entity not found" }));
		expect(writes).toBe(0);
	}).pipe(Effect.provide(layer));
});

it.effect("reconciles a global self-relationship group atomically and deletes stale edges", () => {
	const created: unknown[] = [];
	const deleted: unknown[] = [];
	const updated: unknown[] = [];
	const existing = {
		...relationship,
		wasInserted: false,
		sourceEntityId: EntityId.make("removed-entity-id"),
		targetEntityId: EntityId.make("removed-entity-id"),
	};
	const layer = makeServiceLayer({
		listGlobalRelationships: () => Effect.succeed([existing]),
		deleteRelationship: (input) =>
			Effect.sync(() => {
				deleted.push(input);
				return existing;
			}),
		updateRelationship: (input) =>
			Effect.sync(() => {
				updated.push(input);
				return { ...relationship, wasInserted: false };
			}),
		createRelationship: (input) =>
			Effect.sync(() => {
				created.push(input);
				return { ...relationship, wasInserted: false };
			}),
	});

	return Effect.gen(function* () {
		const service = yield* RelationshipsService;
		const result = yield* service.reconcileGlobal([
			{
				relationshipSchemaSlug,
				selector: { type: "self" },
				relationships: [{ properties: {}, sourceEntityId, targetEntityId: sourceEntityId }],
			},
		]);

		expect(result).toEqual([{ deleted: 1, upserted: 1 }]);
		expect(created).toHaveLength(1);
		expect(updated).toHaveLength(1);
		expect(deleted).toHaveLength(1);
	}).pipe(Effect.provide(layer));
});
