import { expect, it } from "@effect/vitest";
import { EntityId, RelationshipSchemaId, UserId } from "@ryot/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";

import { RelationshipsRepository } from "./repository";

type StoredRelationship = {
	id: string;
	createdAt: Date;
	userId: string | null;
	sourceEntityId: string;
	targetEntityId: string;
	relationshipSchemaId: string;
	properties: Record<string, unknown>;
};

const dialect = new PgDialect();
type RenderableSql = Parameters<typeof dialect.sqlToQuery>[0];

const makeLayer = (db: object) =>
	Layer.mergeAll(
		RelationshipsRepository.Default,
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);

type OutcomeEndpoint = { id: string; name: string; entitySchemaSlug: string };

const toSelected = (row: StoredRelationship) => ({
	id: row.id,
	createdAt: row.createdAt,
	properties: row.properties,
	wasInserted: false,
	sourceEntityId: row.sourceEntityId,
	targetEntityId: row.targetEntityId,
	relationshipSchemaId: row.relationshipSchemaId,
});

// Drizzle query builders are chainable and thenable. A native promise already carries
// `then`, so the chain methods are attached to it rather than hand-authoring a thenable.
const makeQuery = (getRows: () => unknown) => {
	const query = Object.assign(Promise.resolve().then(getRows), {
		for: () => query,
		from: () => query,
		where: () => query,
		limit: () => query,
		innerJoin: () => query,
	});
	return query;
};

const makeOutcomeDb = (initial: {
	relationshipSchemaSlug: string;
	rows: ReadonlyArray<StoredRelationship>;
	endpoints: ReadonlyArray<OutcomeEndpoint>;
}) => {
	const state = {
		transactions: 0,
		relationshipSchemaSlug: initial.relationshipSchemaSlug,
		rows: initial.rows.map((row) => ({ ...row })),
		endpoints: initial.endpoints.map((endpoint) => ({ ...endpoint })),
	};
	let counter = state.rows.length;

	const idFromCondition = (condition: RenderableSql) =>
		String(dialect.sqlToQuery(condition).params[0]);

	const insertOne = (value: Omit<StoredRelationship, "id" | "createdAt">) => {
		const exists = state.rows.find(
			(row) =>
				row.userId === value.userId &&
				row.sourceEntityId === value.sourceEntityId &&
				row.targetEntityId === value.targetEntityId &&
				row.relationshipSchemaId === value.relationshipSchemaId,
		);
		if (exists) {
			return [];
		}
		counter += 1;
		const row: StoredRelationship = {
			...value,
			id: `relationship-${counter}`,
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		};
		state.rows.push(row);
		return [{ ...toSelected(row), wasInserted: true }];
	};

	const updateOne = (
		setValues: { properties: Record<string, unknown> },
		condition: RenderableSql,
	) => {
		const id = idFromCondition(condition);
		const row = state.rows.find((candidate) => candidate.id === id);
		if (!row) {
			return [];
		}
		row.properties = setValues.properties;
		return [toSelected(row)];
	};

	const deleteOne = (condition: RenderableSql) => {
		const id = idFromCondition(condition);
		state.rows = state.rows.filter((candidate) => candidate.id !== id);
		return [];
	};

	const tx = Object.assign(Object.create(null), {
		execute: () => Promise.resolve({ rows: [] }),
		select: (selection: Record<string, unknown>) => {
			if ("wasInserted" in selection) {
				return makeQuery(() => state.rows.map(toSelected));
			}
			if ("entitySchemaSlug" in selection) {
				return makeQuery(() => state.endpoints);
			}
			return makeQuery(() => [{ slug: state.relationshipSchemaSlug }]);
		},
		insert: () => ({
			values: (value: Omit<StoredRelationship, "id" | "createdAt">) => ({
				onConflictDoNothing: () => ({ returning: () => makeQuery(() => insertOne(value)) }),
			}),
		}),
		update: () => ({
			set: (setValues: { properties: Record<string, unknown> }) => ({
				where: (condition: RenderableSql) => ({
					returning: () => makeQuery(() => updateOne(setValues, condition)),
				}),
			}),
		}),
		delete: () => ({ where: (condition: RenderableSql) => makeQuery(() => deleteOne(condition)) }),
	});

	const db = Object.assign(Object.create(null), {
		transaction: <A>(callback: (transaction: typeof tx) => Promise<A>) => {
			state.transactions += 1;
			return callback(tx);
		},
	});

	return { db, state };
};

const userId = UserId.make("user-1");
const sourceEntityId = EntityId.make("source-1");
const targetEntityId = EntityId.make("target-1");
const relationshipSchemaId = RelationshipSchemaId.make("schema-follows");

const saveEndpoints: ReadonlyArray<OutcomeEndpoint> = [
	{ id: "source-1", name: "Source", entitySchemaSlug: "person" },
	{ id: "target-1", name: "Target", entitySchemaSlug: "movie" },
];

const existingUserRow = (properties: Record<string, unknown>): StoredRelationship => ({
	userId,
	properties,
	id: "rel-existing",
	sourceEntityId: "source-1",
	targetEntityId: "target-1",
	relationshipSchemaId: "schema-follows",
	createdAt: new Date("2026-06-14T00:00:00.000Z"),
});

it.effect("classifies a fresh save as a create outcome with endpoint snapshots", () => {
	const { db, state } = makeOutcomeDb({
		rows: [],
		endpoints: saveEndpoints,
		relationshipSchemaSlug: "follows",
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.saveRelationship({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			onConflict: "replaceProperties",
			properties: { status: "active" },
		});

		expect(outcome.operation).toBe("create");
		expect(outcome.relationship.wasInserted).toBe(true);
		expect(outcome.before).toBeUndefined();
		expect(outcome.after).toMatchObject({
			relationshipSchemaSlug: "follows",
			properties: { status: "active" },
			source: { id: "source-1", name: "Source", entitySchemaSlug: "person" },
			target: { id: "target-1", name: "Target", entitySchemaSlug: "movie" },
		});
		expect(state.rows).toHaveLength(1);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("classifies a preserved conflict as a noop and leaves properties untouched", () => {
	const { db, state } = makeOutcomeDb({
		rows: [existingUserRow({ status: "old" })],
		endpoints: saveEndpoints,
		relationshipSchemaSlug: "follows",
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.saveRelationship({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			properties: { status: "new" },
			onConflict: "preserveExisting",
		});

		expect(outcome.operation).toBe("noop");
		expect(outcome.relationship.properties).toEqual({ status: "old" });
		expect(outcome.before?.properties).toEqual({ status: "old" });
		expect(outcome.after?.properties).toEqual({ status: "old" });
		expect(state.rows[0]?.properties).toEqual({ status: "old" });
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("classifies identical replaceProperties as a noop", () => {
	const { db } = makeOutcomeDb({
		rows: [existingUserRow({ status: "same" })],
		endpoints: saveEndpoints,
		relationshipSchemaSlug: "follows",
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.saveRelationship({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			properties: { status: "same" },
			onConflict: "replaceProperties",
		});

		expect(outcome.operation).toBe("noop");
		expect(outcome.before?.properties).toEqual({ status: "same" });
		expect(outcome.after?.properties).toEqual({ status: "same" });
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("classifies changed replaceProperties as an update with before/after", () => {
	const { db, state } = makeOutcomeDb({
		rows: [existingUserRow({ status: "old" })],
		endpoints: saveEndpoints,
		relationshipSchemaSlug: "follows",
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.saveRelationship({
			userId,
			scope: "user",
			sourceEntityId,
			targetEntityId,
			relationshipSchemaId,
			properties: { status: "new" },
			onConflict: "replaceProperties",
		});

		expect(outcome.operation).toBe("update");
		expect(outcome.before?.properties).toEqual({ status: "old" });
		expect(outcome.after?.properties).toEqual({ status: "new" });
		expect(state.rows[0]?.properties).toEqual({ status: "new" });
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("returns ordered material mutations for an authoritative anchored sync", () => {
	const { db } = makeOutcomeDb({
		relationshipSchemaSlug: "suggestion",
		endpoints: [
			{ id: "source-a", name: "Source A", entitySchemaSlug: "movie" },
			{ id: "target-existing", name: "Existing", entitySchemaSlug: "movie" },
			{ id: "target-new", name: "New", entitySchemaSlug: "movie" },
			{ id: "target-stale", name: "Stale", entitySchemaSlug: "movie" },
		],
		rows: [
			{
				userId: null,
				id: "rel-existing",
				properties: { rank: 1 },
				sourceEntityId: "source-a",
				targetEntityId: "target-existing",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: null,
				id: "rel-stale",
				properties: {},
				sourceEntityId: "source-a",
				targetEntityId: "target-stale",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
		],
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.syncGlobalRelationships({
			type: "anchored",
			direction: "outgoing",
			onConflict: "replaceProperties",
			synchronization: "authoritative",
			anchorEntityId: EntityId.make("source-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-suggestion"),
			entries: [
				{ entityId: EntityId.make("target-existing"), properties: { rank: 2 } },
				{ entityId: EntityId.make("target-new"), properties: { rank: 3 } },
			],
		});

		expect(outcome.mutations.map((mutation) => mutation.operation)).toEqual([
			"update",
			"create",
			"delete",
		]);
		expect(outcome.mutations[0]?.before?.properties).toEqual({ rank: 1 });
		expect(outcome.mutations[0]?.after?.properties).toEqual({ rank: 2 });
		expect(outcome.mutations[1]?.after?.properties).toEqual({ rank: 3 });
		expect(outcome.mutations[2]?.before?.properties).toEqual({});
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("additive anchored sync produces no delete mutations", () => {
	const { db } = makeOutcomeDb({
		relationshipSchemaSlug: "person-to-movie",
		endpoints: [
			{ id: "person-a", name: "Person A", entitySchemaSlug: "person" },
			{ id: "movie-existing", name: "Existing", entitySchemaSlug: "movie" },
			{ id: "movie-new", name: "New", entitySchemaSlug: "movie" },
		],
		rows: [
			{
				userId: null,
				id: "rel-existing",
				targetEntityId: "person-a",
				properties: { roles: ["Old"] },
				sourceEntityId: "movie-existing",
				relationshipSchemaId: "schema-person-to-movie",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
		],
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.syncGlobalRelationships({
			type: "anchored",
			direction: "incoming",
			synchronization: "additive",
			onConflict: "preserveExisting",
			anchorEntityId: EntityId.make("person-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-person-to-movie"),
			entries: [
				{ entityId: EntityId.make("movie-existing"), properties: { roles: ["New"] } },
				{ entityId: EntityId.make("movie-new"), properties: { roles: ["Actor"] } },
			],
		});

		expect(outcome.mutations.some((mutation) => mutation.operation === "delete")).toBe(false);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("returns ordered material mutations for an authoritative self sync", () => {
	const { db } = makeOutcomeDb({
		relationshipSchemaSlug: "trending",
		endpoints: [
			{ id: "entity-existing", name: "Existing", entitySchemaSlug: "movie" },
			{ id: "entity-new", name: "New", entitySchemaSlug: "movie" },
			{ id: "entity-stale", name: "Stale", entitySchemaSlug: "movie" },
		],
		rows: [
			{
				userId: null,
				id: "rel-existing",
				sourceEntityId: "entity-existing",
				targetEntityId: "entity-existing",
				relationshipSchemaId: "schema-trending",
				properties: { rank: 5 },
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: null,
				id: "rel-stale",
				sourceEntityId: "entity-stale",
				targetEntityId: "entity-stale",
				relationshipSchemaId: "schema-trending",
				properties: {},
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
		],
	});

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const outcome = yield* repository.syncGlobalRelationships({
			type: "self",
			onConflict: "replaceProperties",
			synchronization: "authoritative",
			relationshipSchemaId: RelationshipSchemaId.make("schema-trending"),
			entries: [
				{ entityId: EntityId.make("entity-existing"), properties: { rank: 1 } },
				{ entityId: EntityId.make("entity-new"), properties: { rank: 2 } },
			],
		});

		expect(outcome.mutations.map((mutation) => mutation.operation)).toEqual([
			"update",
			"create",
			"delete",
		]);
		expect(outcome.mutations[0]?.before?.properties).toEqual({ rank: 5 });
		expect(outcome.mutations[0]?.after?.properties).toEqual({ rank: 1 });
		expect(outcome.mutations[1]?.after?.properties).toEqual({ rank: 2 });
		expect(outcome.mutations[2]?.before?.properties).toEqual({});
	}).pipe(Effect.provide(makeLayer(db)));
});
