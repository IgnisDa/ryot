import { assert, expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { SavedViewsRepository } from "./repository";

const userId = UserId.make("user-1");
const savedViewRow = (input: {
	id: string;
	slug: string;
	isBuiltin: boolean;
	pluginInstallationId: string | null;
}) => ({
	...input,
	userId,
	icon: "old",
	name: "Old",
	revision: 1,
	settings: {},
	sortOrder: 9,
	isDisabled: true,
	dataSources: null,
	pluginSlug: "private",
	clientRendererId: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
	renderer: { kind: "kernel", name: "results-table" } as const,
});

const makeLayer = (
	existing: ReadonlyArray<ReturnType<typeof savedViewRow>>,
	mutations: { deletes: number; inserts: unknown[]; updates: unknown[] },
) => {
	const database = Database.of(
		Object.assign(Object.create(null), {
			select: () => ({ from: () => ({ where: () => Effect.succeed(existing) }) }),
			delete: () => ({ where: () => Effect.sync(() => void (mutations.deletes += 1)) }),
			insert: () => ({
				values: (values: unknown) => Effect.sync(() => void mutations.inserts.push(values)),
			}),
			update: () => ({
				set: (values: unknown) => ({
					where: () => Effect.sync(() => void mutations.updates.push(values)),
				}),
			}),
		}),
	);
	const databaseLayer = Layer.succeed(Database, database);
	return Layer.merge(databaseLayer, SavedViewsRepository.layer.pipe(Layer.provide(databaseLayer)));
};

const desiredView = {
	settings: {},
	sortOrder: 1,
	icon: "updated",
	name: "Updated",
	dataSources: null,
	slug: "generated",
	pluginInstallationId: "installation-id",
	renderer: { kind: "kernel", name: "results-table" } as const,
};

it.effect("reconciles generated views while preserving user-controlled state", () => {
	const mutations = { deletes: 0, inserts: [] as unknown[], updates: [] as unknown[] };
	const layer = makeLayer(
		[
			savedViewRow({
				id: "current",
				isBuiltin: true,
				slug: "generated",
				pluginInstallationId: "installation-id",
			}),
			savedViewRow({
				id: "obsolete",
				isBuiltin: true,
				slug: "obsolete",
				pluginInstallationId: "installation-id",
			}),
		],
		mutations,
	);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		yield* repository.ensureBuiltinViews(userId, [desiredView]);
		expect(mutations.deletes).toBe(1);
		expect(mutations.inserts).toEqual([]);
		expect(mutations.updates).toEqual([
			expect.not.objectContaining({ sortOrder: expect.anything(), isDisabled: expect.anything() }),
		]);
		expect(mutations.updates).toMatchObject([
			{ name: "Updated", icon: "updated", renderer: desiredView.renderer },
		]);
	}).pipe(Effect.provide(layer));
});

it.effect("keeps a generated view revision stable when the desired definition is unchanged", () => {
	const mutations = { deletes: 0, inserts: [] as unknown[], updates: [] as unknown[] };
	const current = savedViewRow({
		id: "current",
		isBuiltin: true,
		slug: "generated",
		pluginInstallationId: "installation-id",
	});
	const layer = makeLayer(
		[
			{
				...current,
				name: desiredView.name,
				icon: desiredView.icon,
				renderer: desiredView.renderer,
			},
		],
		mutations,
	);
	return Effect.gen(function* () {
		yield* (yield* SavedViewsRepository).ensureBuiltinViews(userId, [desiredView]);
		expect(mutations).toEqual({ deletes: 0, inserts: [], updates: [] });
	}).pipe(Effect.provide(layer));
});

it.effect("rejects a generated view slug owned by a custom view", () => {
	const mutations = { deletes: 0, inserts: [] as unknown[], updates: [] as unknown[] };
	const layer = makeLayer(
		[
			savedViewRow({
				id: "custom",
				isBuiltin: false,
				slug: "generated",
				pluginInstallationId: null,
			}),
		],
		mutations,
	);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		const exit = yield* Effect.exit(repository.ensureBuiltinViews(userId, [desiredView]));
		assert(Exit.isFailure(exit));
		const failure = Cause.findErrorOption(exit.cause);
		assert(Option.isSome(failure));
		expect(failure.value).toMatchObject({
			_tag: "DbError",
			message: "Saved view slug is owned by another view: generated",
		});
		expect(mutations).toEqual({ deletes: 0, inserts: [], updates: [] });
	}).pipe(Effect.provide(layer));
});

it.effect("checks custom references for the exact installation and user", () => {
	const conditions: Array<Parameters<PgDialect["sqlToQuery"]>[0]> = [];
	const database = Database.of(
		Object.assign(Object.create(null), {
			select: () => ({
				from: () => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
						limit: () => {
							conditions.push(condition);
							return Effect.succeed([{ id: "custom-view" }]);
						},
					}),
				}),
			}),
		}),
	);
	const layer = Layer.mergeAll(
		Layer.succeed(Database, database),
		SavedViewsRepository.layer.pipe(Layer.provide(Layer.succeed(Database, database))),
	);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		expect(yield* repository.hasCustomInstallationReferences(userId, "installation-id")).toBe(true);
		const [condition] = conditions;
		assert(condition);
		const rendered = new PgDialect().sqlToQuery(condition);
		expect(rendered.sql).toContain('"saved_view"."user_id" = $1');
		expect(rendered.sql).toContain('"saved_view"."is_builtin" = $2');
		expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" = $3');
		expect(rendered.params).toEqual([userId, false, "installation-id"]);
	}).pipe(Effect.provide(layer));
});

it.effect("reorders a scope with one set-based statement", () => {
	const statements: Array<{
		set: Parameters<PgDialect["sqlToQuery"]>[0];
		where: Parameters<PgDialect["sqlToQuery"]>[0];
	}> = [];
	const database = Database.of(
		Object.assign(Object.create(null), {
			update: () => ({
				set: (values: { sortOrder: Parameters<PgDialect["sqlToQuery"]>[0] }) => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
						returning: () => {
							statements.push({ where: condition, set: values.sortOrder });
							return Effect.succeed([{ slug: "view-b" }, { slug: "view-a" }]);
						},
					}),
				}),
			}),
		}),
	);
	const layer = Layer.mergeAll(
		Layer.succeed(Database, database),
		SavedViewsRepository.layer.pipe(Layer.provide(Layer.succeed(Database, database))),
	);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		expect(yield* repository.reorderBySlugs(userId, "installation-id", ["view-b", "view-a"])).toBe(
			2,
		);
		expect(statements).toHaveLength(1);
		const [statement] = statements;
		assert(statement);
		const dialect = new PgDialect();
		const ordering = dialect.sqlToQuery(statement.set);
		expect(ordering.sql).toBe(
			'case "saved_view"."slug" when $1 then $2::integer when $3 then $4::integer end',
		);
		expect(ordering.params).toEqual(["view-b", 0, "view-a", 1]);
		const scope = dialect.sqlToQuery(statement.where);
		expect(scope.sql).toContain('"saved_view"."plugin_installation_id" = $');
		expect(scope.params).toEqual([userId, "view-b", "view-a", "installation-id"]);
	}).pipe(Effect.provide(layer));
});

it.effect("restricts a top-level reorder to views without a plugin installation", () => {
	const conditions: Array<Parameters<PgDialect["sqlToQuery"]>[0]> = [];
	const database = Database.of(
		Object.assign(Object.create(null), {
			update: () => ({
				set: () => ({
					where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => ({
						returning: () => {
							conditions.push(condition);
							return Effect.succeed([{ slug: "view-a" }]);
						},
					}),
				}),
			}),
		}),
	);
	const layer = Layer.mergeAll(
		Layer.succeed(Database, database),
		SavedViewsRepository.layer.pipe(Layer.provide(Layer.succeed(Database, database))),
	);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		expect(yield* repository.reorderBySlugs(userId, null, ["view-a"])).toBe(1);
		const [condition] = conditions;
		assert(condition);
		const rendered = new PgDialect().sqlToQuery(condition);
		expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" is null');
		expect(rendered.params).toEqual([userId, "view-a"]);
	}).pipe(Effect.provide(layer));
});
