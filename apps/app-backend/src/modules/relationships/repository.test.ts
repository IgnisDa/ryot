import { expect, it } from "@effect/vitest";
import {
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot/contract/schema/brands";
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
	relationshipSchemaSlug: string;
	properties: Record<string, unknown>;
};

const dialect = new PgDialect();
type RenderableSql = Parameters<typeof dialect.sqlToQuery>[0];

const makeDb = (initialRows: ReadonlyArray<StoredRelationship> = []) => {
	const state = { executeCalls: 0, forUpdateCalls: 0, rows: [...initialRows] };

	const paramsFor = (condition: RenderableSql) => {
		const rendered = dialect.sqlToQuery(condition);
		return rendered.params.flatMap((param) =>
			Array.isArray(param) ? param.map(String) : [String(param)],
		);
	};

	const matches = (condition: RenderableSql, row: StoredRelationship) => {
		const rendered = dialect.sqlToQuery(condition);
		const text = rendered.sql;
		const params = paramsFor(condition);
		if (text.includes('"relationship"."id"')) {
			return row.id === params[0] && row.userId === params[1];
		}

		if (text.includes('"relationship"."userId" is null')) {
			if (row.userId !== null) {
				return false;
			}
			if (params.length === 3) {
				return (
					row.sourceEntityId === params[0] &&
					row.targetEntityId === params[1] &&
					row.relationshipSchemaSlug === params[2]
				);
			}
			if (text.includes('"relationship"."sourceEntityId" = "relationship"."targetEntityId"')) {
				return (
					row.sourceEntityId === row.targetEntityId && row.relationshipSchemaSlug === params[0]
				);
			}
			const incoming = text.includes('"relationship"."targetEntityId" =');
			return (
				(incoming ? row.targetEntityId : row.sourceEntityId) === params[0] &&
				row.relationshipSchemaSlug === params[1]
			);
		}

		if (params.length === 4) {
			return (
				row.userId === params[0] &&
				row.sourceEntityId === params[1] &&
				row.targetEntityId === params[2] &&
				row.relationshipSchemaSlug === params[3]
			);
		}

		return (
			row.userId === params[0] &&
			(params.slice(1).includes(row.sourceEntityId) || params.slice(1).includes(row.targetEntityId))
		);
	};

	const select = () => ({
		from: () => ({
			where: (condition: RenderableSql) => {
				const rows = () => state.rows.filter((row) => matches(condition, row));
				const limited = Object.assign(Promise.resolve(rows().slice(0, 1)), {
					for: () => {
						state.forUpdateCalls += 1;
						return Promise.resolve(rows().slice(0, 1));
					},
				});
				return {
					for: () => {
						state.forUpdateCalls += 1;
						return Promise.resolve(rows());
					},
					limit: () => limited,
				};
			},
		}),
	});

	const insert = () => ({
		values: (values: StoredRelationship | ReadonlyArray<StoredRelationship>) => {
			const inputs = Array.isArray(values) ? values : [values];
			const inserted: StoredRelationship[] = [];
			const onConflictDoNothing = () => {
				for (const input of inputs) {
					const existing = state.rows.some(
						(row) =>
							row.userId === input.userId &&
							row.sourceEntityId === input.sourceEntityId &&
							row.targetEntityId === input.targetEntityId &&
							row.relationshipSchemaSlug === input.relationshipSchemaSlug,
					);
					if (existing) {
						continue;
					}

					const row = {
						...input,
						createdAt: new Date("2026-06-14T00:00:00.000Z"),
						id: `relationship-${state.rows.length + 1}`,
					};
					state.rows.push(row);
					inserted.push(row);
				}
				return {
					returning: () =>
						Promise.resolve(inserted.map((row) => Object.assign({}, row, { wasInserted: true }))),
				};
			};

			return { onConflictDoNothing };
		},
	});

	const update = () => ({
		set: (values: Partial<StoredRelationship>) => ({
			where: (condition: RenderableSql) => ({
				returning: () => {
					const updated = state.rows.filter((row) => matches(condition, row));
					for (const row of updated) {
						Object.assign(row, values);
					}
					return Promise.resolve(updated);
				},
			}),
		}),
	});

	const remove = () => ({
		where: (condition: RenderableSql) => ({
			returning: () => {
				const deleted = state.rows.filter((row) => matches(condition, row));
				state.rows = state.rows.filter((row) => !matches(condition, row));
				return Promise.resolve(deleted);
			},
		}),
	});

	const db = {
		delete: remove,
		execute: () => {
			state.executeCalls += 1;
			return Promise.resolve(undefined);
		},
		insert,
		select,
		update,
	};
	return { db, state };
};

const makeLayer = (db: object) =>
	Layer.mergeAll(
		RelationshipsRepository.Default,
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);

const globalInput = {
	scope: "global" as const,
	sourceEntityId: EntityId.make("source"),
	targetEntityId: EntityId.make("target"),
	relationshipSchemaSlug: RelationshipSchemaSlug.make("schema"),
};

it.effect("creates once and preserves an existing relationship on conflict", () => {
	const { db, state } = makeDb();

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const created = yield* repository.createRelationship({
			...globalInput,
			properties: { rank: 1 },
		});
		const existing = yield* repository.createRelationship({
			...globalInput,
			properties: { rank: 2 },
		});

		expect(created.wasInserted).toBe(true);
		expect(existing.wasInserted).toBe(false);
		expect(existing.properties).toEqual({ rank: 1 });
		expect(state.forUpdateCalls).toBe(1);
		expect(state.rows).toHaveLength(1);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("updates only an existing relationship", () => {
	const { db } = makeDb();

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		yield* repository.createRelationship({ ...globalInput, properties: { rank: 1 } });

		const updated = yield* repository.updateRelationship({
			...globalInput,
			properties: { rank: 2 },
		});
		const missing = yield* repository.updateRelationship({
			...globalInput,
			targetEntityId: EntityId.make("missing"),
			properties: { rank: 3 },
		});

		expect(updated?.properties).toEqual({ rank: 2 });
		expect(updated?.wasInserted).toBe(false);
		expect(missing).toBeNull();
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("lists and deletes user relationships without touching global rows", () => {
	const { db, state } = makeDb([
		{
			id: "user-row",
			properties: {},
			userId: "user-1",
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			relationshipSchemaSlug: "schema",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			userId: null,
			properties: {},
			id: "global-row",
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			relationshipSchemaSlug: "schema",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const rows = yield* repository.listUserRelationshipsForEntity({
			userId: UserId.make("user-1"),
			entityId: EntityId.make("entity-1"),
		});
		const globalRows = yield* repository.listGlobalRelationships({
			type: "anchored",
			direction: "outgoing",
			anchorEntityId: EntityId.make("entity-1"),
			relationshipSchemaSlug: RelationshipSchemaSlug.make("schema"),
		});
		const deleted = yield* repository.deleteRelationship({
			scope: "user",
			userId: UserId.make("user-1"),
			sourceEntityId: EntityId.make("entity-1"),
			targetEntityId: EntityId.make("entity-2"),
			relationshipSchemaSlug: RelationshipSchemaSlug.make("schema"),
		});

		expect(rows).toHaveLength(1);
		expect(globalRows).toHaveLength(1);
		expect(state.executeCalls).toBe(1);
		expect(deleted?.id).toBe("user-row");
		expect(state.rows.map((row) => row.id)).toEqual(["global-row"]);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("deletes by exact relationship and user ids", () => {
	const { db, state } = makeDb([
		{
			properties: {},
			userId: "user-1",
			id: "relationship-1",
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			relationshipSchemaSlug: "schema",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
		{
			properties: {},
			userId: "user-2",
			id: "relationship-2",
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			relationshipSchemaSlug: "schema",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const wrongUser = yield* repository.deleteUserRelationshipById(
			UserId.make("user-2"),
			RelationshipId.make("relationship-1"),
		);
		const removed = yield* repository.deleteUserRelationshipById(
			UserId.make("user-1"),
			RelationshipId.make("relationship-1"),
		);

		expect(wrongUser).toBe(false);
		expect(removed).toBe(true);
		expect(state.rows.map(({ id }) => id)).toEqual(["relationship-2"]);
	}).pipe(Effect.provide(makeLayer(db)));
});

it.effect("does not delete a concurrent replacement with a different id", () => {
	const { db, state } = makeDb([
		{
			properties: {},
			userId: "user-1",
			sourceEntityId: "entity-1",
			targetEntityId: "entity-2",
			id: "replacement-relationship",
			relationshipSchemaSlug: "schema",
			createdAt: new Date("2026-06-14T00:00:00.000Z"),
		},
	]);

	return Effect.gen(function* () {
		const repository = yield* RelationshipsRepository;
		const removed = yield* repository.deleteUserRelationshipById(
			UserId.make("user-1"),
			RelationshipId.make("original-relationship"),
		);

		expect(removed).toBe(false);
		expect(state.rows.map(({ id }) => id)).toEqual(["replacement-relationship"]);
	}).pipe(Effect.provide(makeLayer(db)));
});
