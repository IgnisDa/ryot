import { assert, expect, it } from "@effect/vitest";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { EntitySchemaSlug, PluginSlug, UserId } from "@ryot/contract/schema/brands";
import { ascending, column, document, field, rows, table } from "@ryot/ryotql";
import { Cause, Effect, Exit, Layer, Option } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { SavedViewsRepository } from "./repository";

const userId = UserId.make("user-1");
const entity = table("entity", "book");
const queryDocument = document({
	savedView: rows(entity, {
		orderBy: [ascending(column(entity, "name"))],
		fields: [field("id", column(entity, "id")), field("name", column(entity, "name"))],
	}),
});
const cardLayout = {
	queryDocument,
	callout: null,
	overline: null,
	imageField: null,
	titleField: "name",
	entityIdField: "id",
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const layouts = {
	grid: cardLayout,
	list: cardLayout,
	table: {
		queryDocument,
		imageField: null,
		entityIdField: "id",
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;

const savedViewRow = (input: {
	id: string;
	slug: string;
	isBuiltin: boolean;
	pluginInstallationId: string | null;
}) => ({
	...input,
	userId,
	layouts,
	icon: "old",
	name: "Old",
	sortOrder: 9,
	isDisabled: true,
	pluginSlug: "private",
	entitySchemaSlug: "book",
	createdAt: new Date(0),
	updatedAt: new Date(0),
	entitySchemaPluginId: "plugin-id",
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
	layouts,
	sortOrder: 1,
	icon: "updated",
	name: "Updated",
	slug: "generated",
	entitySchemaPluginId: "plugin-id",
	pluginInstallationId: "installation-id",
	pluginSlug: PluginSlug.make("private"),
	entitySchemaSlug: EntitySchemaSlug.make("book"),
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
			expect.not.objectContaining({ isDisabled: expect.anything(), sortOrder: expect.anything() }),
		]);
		expect(mutations.updates).toMatchObject([{ name: "Updated", icon: "updated" }]);
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
