import { expect, it } from "@effect/vitest";
import { EntityId, RelationshipSchemaId } from "@ryot/contract/schema/brands";
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

const makeDb = (rows: ReadonlyArray<StoredRelationship>) => {
	const state = {
		rows: [...rows],
		transactions: 0,
	};

	const findGlobalRelationship = (value: {
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
	}) =>
		state.rows.find(
			(row) =>
				row.userId === null &&
				row.sourceEntityId === value.sourceEntityId &&
				row.targetEntityId === value.targetEntityId &&
				row.relationshipSchemaId === value.relationshipSchemaId,
		);

	const insertGlobalRelationship = (value: {
		userId: string | null;
		sourceEntityId: string;
		targetEntityId: string;
		relationshipSchemaId: string;
		properties: Record<string, unknown>;
	}) => {
		state.rows.push({
			...value,
			id: `relationship-${state.rows.length + 1}`,
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		});
	};
	const tx = Object.assign(Object.create(null), {
		insert: () => ({
			values: (
				values: ReadonlyArray<{
					userId: string | null;
					sourceEntityId: string;
					targetEntityId: string;
					relationshipSchemaId: string;
					properties: Record<string, unknown>;
				}>,
			) => ({
				onConflictDoNothing: () => {
					for (const value of values) {
						if (!findGlobalRelationship(value)) {
							insertGlobalRelationship(value);
						}
					}

					return Promise.resolve(undefined);
				},
				onConflictDoUpdate: () => {
					for (const value of values) {
						const existing = findGlobalRelationship(value);
						if (existing) {
							existing.properties = value.properties;
						} else {
							insertGlobalRelationship(value);
						}
					}

					return Promise.resolve(undefined);
				},
			}),
		}),
		delete: () => ({
			where: (condition: RenderableSql) => {
				const rendered = dialect.sqlToQuery(condition);
				const params = rendered.params.flatMap((param) =>
					Array.isArray(param) ? param.map(String) : [String(param)],
				);
				const isSelfEdgeDelete = rendered.sql.includes(
					'"relationship"."sourceEntityId" = "relationship"."targetEntityId"',
				);

				if (isSelfEdgeDelete) {
					const [relationshipSchemaId, ...sourceEntityIds] = params;
					const keptSources = new Set(sourceEntityIds);

					state.rows = state.rows.filter((row) => {
						if (row.userId !== null) {
							return true;
						}
						if (row.relationshipSchemaId !== relationshipSchemaId) {
							return true;
						}
						if (row.sourceEntityId !== row.targetEntityId) {
							return true;
						}
						if (keptSources.size === 0) {
							return false;
						}
						return keptSources.has(row.sourceEntityId);
					});

					return Promise.resolve([]);
				}

				const isIncoming = rendered.sql.includes('"relationship"."targetEntityId" =');
				const [anchorEntityId, relationshipSchemaId, ...relatedEntityIds] = params;
				const keptRelatedEntities = new Set(relatedEntityIds);

				state.rows = state.rows.filter((row) => {
					if (row.userId !== null) {
						return true;
					}
					if ((isIncoming ? row.targetEntityId : row.sourceEntityId) !== anchorEntityId) {
						return true;
					}
					if (row.relationshipSchemaId !== relationshipSchemaId) {
						return true;
					}
					if (keptRelatedEntities.size === 0) {
						return false;
					}
					return keptRelatedEntities.has(isIncoming ? row.sourceEntityId : row.targetEntityId);
				});

				return Promise.resolve([]);
			},
		}),
	});

	const db = Object.assign(Object.create(null), {
		transaction: <A>(callback: (transaction: typeof tx) => Promise<A>) => {
			state.transactions += 1;
			return callback(tx);
		},
	});

	return { db, state };
};

const makeLayer = (db: object) =>
	Layer.mergeAll(
		RelationshipsRepository.Default,
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);

it.effect(
	"authoritatively syncs anchored global targets while preserving existing properties",
	() => {
		const { db, state } = makeDb([
			{
				userId: null,
				properties: {},
				id: "rel-old-stale",
				targetEntityId: "target-old",
				sourceEntityId: "source-a",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: null,
				properties: { source: "existing" },
				id: "rel-keep-existing",
				targetEntityId: "target-keep",
				sourceEntityId: "source-a",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: null,
				properties: {},
				id: "rel-other-schema",
				targetEntityId: "target-other-schema",
				sourceEntityId: "source-a",
				relationshipSchemaId: "schema-other",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: null,
				properties: {},
				id: "rel-other-source",
				targetEntityId: "target-other-source",
				sourceEntityId: "source-b",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
			{
				userId: "user-1",
				properties: {},
				id: "rel-user-row",
				targetEntityId: "target-user",
				sourceEntityId: "source-a",
				relationshipSchemaId: "schema-suggestion",
				createdAt: new Date("2026-06-14T00:00:00.000Z"),
			},
		]);

		return Effect.gen(function* () {
			const repository = yield* RelationshipsRepository;
			yield* repository.syncGlobalRelationships({
				type: "anchored",
				entries: [
					{ entityId: EntityId.make("target-keep"), properties: {} },
					{ entityId: EntityId.make("target-new"), properties: {} },
					{ entityId: EntityId.make("target-new"), properties: {} },
				],
				direction: "outgoing",
				onConflict: "preserveExisting",
				anchorEntityId: EntityId.make("source-a"),
				relationshipSchemaId: RelationshipSchemaId.make("schema-suggestion"),
				synchronization: "authoritative",
			});

			expect(state.transactions).toBe(1);
			expect(
				state.rows.filter(
					(row) =>
						row.userId === null &&
						row.sourceEntityId === "source-a" &&
						row.relationshipSchemaId === "schema-suggestion",
				),
			).toEqual([
				expect.objectContaining({
					id: "rel-keep-existing",
					properties: { source: "existing" },
					targetEntityId: "target-keep",
				}),
				expect.objectContaining({ targetEntityId: "target-new" }),
			]);
			expect(state.rows.map((row) => row.id)).toContain("rel-other-schema");
			expect(state.rows.map((row) => row.id)).toContain("rel-other-source");
			expect(state.rows.map((row) => row.id)).toContain("rel-user-row");
			expect(state.rows.map((row) => row.id)).not.toContain("rel-old-stale");
		}).pipe(Effect.provide(makeLayer(db)));
	},
);

it.effect("clears all global targets for a source and schema when syncing an empty set", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			properties: {},
			id: "rel-a",
			targetEntityId: "target-a",
			sourceEntityId: "source-a",
			relationshipSchemaId: "schema-suggestion",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			properties: {},
			id: "rel-b",
			targetEntityId: "target-b",
			sourceEntityId: "source-a",
			relationshipSchemaId: "schema-suggestion",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			properties: {},
			id: "rel-other",
			targetEntityId: "target-other",
			sourceEntityId: "source-a",
			relationshipSchemaId: "schema-other",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "anchored",
			entries: [],
			direction: "outgoing",
			onConflict: "preserveExisting",
			anchorEntityId: EntityId.make("source-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-suggestion"),
			synchronization: "authoritative",
		});

		expect(state.transactions).toBe(1);
		expect(
			state.rows.filter(
				(row) =>
					row.userId === null &&
					row.sourceEntityId === "source-a" &&
					row.relationshipSchemaId === "schema-suggestion",
			),
		).toHaveLength(0);
		expect(state.rows.map((row) => row.id)).toContain("rel-other");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("replaces properties while authoritatively syncing anchored global relationships", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			id: "rel-stale",
			sourceEntityId: "source-a",
			properties: { roles: ["Old"] },
			targetEntityId: "target-stale",
			relationshipSchemaId: "schema-credit",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-existing",
			sourceEntityId: "source-a",
			properties: { roles: ["Old"] },
			targetEntityId: "target-existing",
			relationshipSchemaId: "schema-credit",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "anchored",
			direction: "outgoing",
			onConflict: "replaceProperties",
			anchorEntityId: EntityId.make("source-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-credit"),
			synchronization: "authoritative",
			entries: [
				{ entityId: EntityId.make("target-existing"), properties: { roles: ["Artist"] } },
				{ entityId: EntityId.make("target-new"), properties: { roles: ["Writer"] } },
				{ entityId: EntityId.make("target-new"), properties: { roles: ["Editor"] } },
			],
		});

		expect(state.transactions).toBe(1);
		expect(state.rows.find((row) => row.targetEntityId === "target-stale")).toBeUndefined();
		expect(state.rows.find((row) => row.targetEntityId === "target-existing")?.properties).toEqual({
			roles: ["Artist"],
		});
		expect(state.rows.find((row) => row.targetEntityId === "target-new")?.properties).toEqual({
			roles: ["Editor"],
		});
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("preserves existing incoming global relationships and properties", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			id: "rel-stale",
			targetEntityId: "person-a",
			sourceEntityId: "movie-stale",
			properties: { roles: ["Old"] },
			relationshipSchemaId: "schema-person-to-movie",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-existing",
			targetEntityId: "person-a",
			properties: { roles: ["Old"] },
			sourceEntityId: "movie-existing",
			relationshipSchemaId: "schema-person-to-movie",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-other-target",
			properties: { roles: ["Director"] },
			targetEntityId: "person-b",
			sourceEntityId: "movie-stale",
			relationshipSchemaId: "schema-person-to-movie",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			properties: {},
			id: "rel-other-schema",
			targetEntityId: "person-a",
			sourceEntityId: "movie-other",
			relationshipSchemaId: "schema-other",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "anchored",
			direction: "incoming",
			onConflict: "preserveExisting",
			anchorEntityId: EntityId.make("person-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-person-to-movie"),
			synchronization: "additive",
			entries: [
				{ entityId: EntityId.make("movie-existing"), properties: { roles: ["Writer"] } },
				{ entityId: EntityId.make("movie-new"), properties: { roles: ["Actor"] } },
			],
		});

		expect(state.rows.find((row) => row.id === "rel-stale")).toBeDefined();
		expect(state.rows.find((row) => row.id === "rel-existing")?.properties).toEqual({
			roles: ["Old"],
		});
		expect(
			state.rows.find(
				(row) =>
					row.sourceEntityId === "movie-new" &&
					row.targetEntityId === "person-a" &&
					row.relationshipSchemaId === "schema-person-to-movie",
			),
		).toMatchObject({ properties: { roles: ["Actor"] } });
		expect(state.rows.map((row) => row.id)).toContain("rel-other-target");
		expect(state.rows.map((row) => row.id)).toContain("rel-other-schema");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("authoritatively syncs incoming global relationships and properties", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			id: "rel-stale",
			targetEntityId: "book-a",
			sourceEntityId: "person-stale",
			properties: { roles: ["Author"] },
			relationshipSchemaId: "schema-person-to-book",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-existing",
			targetEntityId: "book-a",
			sourceEntityId: "person-existing",
			properties: { roles: ["Editor"] },
			relationshipSchemaId: "schema-person-to-book",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-other-anchor",
			targetEntityId: "book-b",
			sourceEntityId: "person-stale",
			properties: { roles: ["Author"] },
			relationshipSchemaId: "schema-person-to-book",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "anchored",
			direction: "incoming",
			onConflict: "replaceProperties",
			anchorEntityId: EntityId.make("book-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-person-to-book"),
			synchronization: "authoritative",
			entries: [
				{ entityId: EntityId.make("person-existing"), properties: { roles: ["Author"] } },
				{ entityId: EntityId.make("person-new"), properties: { roles: ["Translator"] } },
			],
		});

		expect(state.rows.find((row) => row.id === "rel-stale")).toBeUndefined();
		expect(state.rows.find((row) => row.id === "rel-existing")?.properties).toEqual({
			roles: ["Author"],
		});
		expect(
			state.rows.find(
				(row) => row.sourceEntityId === "person-new" && row.targetEntityId === "book-a",
			)?.properties,
		).toEqual({ roles: ["Translator"] });
		expect(state.rows.map((row) => row.id)).toContain("rel-other-anchor");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("keeps incoming relationships when an incoming group is empty", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			id: "rel-clear-a",
			targetEntityId: "movie-a",
			sourceEntityId: "person-a",
			properties: { roles: ["Writer"] },
			relationshipSchemaId: "schema-person-to-movie",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			targetEntityId: "movie-b",
			sourceEntityId: "person-a",
			id: "rel-keep-other-anchor",
			properties: { roles: ["Director"] },
			relationshipSchemaId: "schema-person-to-movie",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			properties: {},
			targetEntityId: "movie-a",
			sourceEntityId: "person-b",
			id: "rel-keep-other-schema",
			relationshipSchemaId: "schema-other",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "anchored",
			entries: [],
			direction: "incoming",
			onConflict: "preserveExisting",
			anchorEntityId: EntityId.make("movie-a"),
			relationshipSchemaId: RelationshipSchemaId.make("schema-person-to-movie"),
			synchronization: "additive",
		});

		expect(state.rows.map((row) => row.id)).toContain("rel-clear-a");
		expect(state.rows.map((row) => row.id)).toContain("rel-keep-other-anchor");
		expect(state.rows.map((row) => row.id)).toContain("rel-keep-other-schema");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("syncs global self edges with properties and removes stale edges", () => {
	const { db, state } = makeDb([
		{
			userId: null,
			id: "rel-stale",
			sourceEntityId: "entity-stale",
			targetEntityId: "entity-stale",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
			properties: { rank: 9, fetchedAt: "2026-01-01T00:00:00.000Z" },
		},
		{
			userId: null,
			id: "rel-existing",
			sourceEntityId: "entity-existing",
			targetEntityId: "entity-existing",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
			properties: { rank: 4, fetchedAt: "2026-01-01T00:00:00.000Z" },
		},
		{
			userId: null,
			id: "rel-non-self",
			properties: { rank: 99 },
			targetEntityId: "entity-other",
			sourceEntityId: "entity-existing",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-other-schema",
			properties: { rank: 9 },
			sourceEntityId: "entity-stale",
			targetEntityId: "entity-stale",
			relationshipSchemaId: "schema-other",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			id: "rel-user",
			userId: "user-1",
			properties: { rank: 9 },
			sourceEntityId: "entity-stale",
			targetEntityId: "entity-stale",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "self",
			onConflict: "replaceProperties",
			synchronization: "authoritative",
			relationshipSchemaId: RelationshipSchemaId.make("schema-trending"),
			entries: [
				{
					entityId: EntityId.make("entity-existing"),
					properties: { rank: 1, fetchedAt: "2026-07-01T00:00:00.000Z" },
				},
				{
					entityId: EntityId.make("entity-new"),
					properties: { rank: 2, fetchedAt: "2026-07-01T00:00:00.000Z" },
				},
			],
		});

		expect(state.transactions).toBe(1);
		expect(
			state.rows.filter(
				(row) =>
					row.userId === null &&
					row.sourceEntityId === row.targetEntityId &&
					row.relationshipSchemaId === "schema-trending",
			),
		).toEqual([
			expect.objectContaining({
				id: "rel-existing",
				sourceEntityId: "entity-existing",
				properties: { rank: 1, fetchedAt: "2026-07-01T00:00:00.000Z" },
			}),
			expect.objectContaining({
				sourceEntityId: "entity-new",
				targetEntityId: "entity-new",
				properties: { rank: 2, fetchedAt: "2026-07-01T00:00:00.000Z" },
			}),
		]);
		expect(state.rows.map((row) => row.id)).not.toContain("rel-stale");
		expect(state.rows.map((row) => row.id)).toContain("rel-non-self");
		expect(state.rows.map((row) => row.id)).toContain("rel-other-schema");
		expect(state.rows.map((row) => row.id)).toContain("rel-user");
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("clears global self edges for a schema when syncing an empty set", () => {
	const { db, state } = makeDb([
		{
			id: "rel-a",
			userId: null,
			properties: { rank: 1 },
			sourceEntityId: "entity-a",
			targetEntityId: "entity-a",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			id: "rel-b",
			userId: null,
			properties: { rank: 2 },
			sourceEntityId: "entity-b",
			targetEntityId: "entity-b",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			id: "rel-non-self",
			properties: { rank: 3 },
			sourceEntityId: "entity-a",
			targetEntityId: "entity-c",
			relationshipSchemaId: "schema-trending",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.syncGlobalRelationships({
			type: "self",
			onConflict: "replaceProperties",
			synchronization: "authoritative",
			entries: [],
			relationshipSchemaId: RelationshipSchemaId.make("schema-trending"),
		});

		expect(state.transactions).toBe(1);
		expect(
			state.rows.filter(
				(row) =>
					row.userId === null &&
					row.sourceEntityId === row.targetEntityId &&
					row.relationshipSchemaId === "schema-trending",
			),
		).toHaveLength(0);
		expect(state.rows.map((row) => row.id)).toContain("rel-non-self");
	}).pipe(Effect.provide(makeLayer(db)));
});
