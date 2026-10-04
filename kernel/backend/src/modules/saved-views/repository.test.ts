import { assert, expect, layer } from "@effect/vitest";
import { PluginId, SavedViewId, UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import { savedView } from "#schema/tables/views";
import { fakeDatabaseSession } from "#testing/effect";

import { SavedViewsRepository } from "./repository";

type Condition = Parameters<PgDialect["sqlToQuery"]>[0];

class RecordedConditions extends Context.Service<
	RecordedConditions,
	{ readonly conditions: Effect.Effect<ReadonlyArray<Condition>> }
>()("test/RecordedConditions") {}

const recordingDatabaseLayer = Layer.unwrap(
	Effect.gen(function* () {
		const conditions = yield* Ref.make<ReadonlyArray<Condition>>([]);
		const database = Object.assign(Object.create(null), {
			select: () => ({
				from: (table: unknown) => ({
					where: (condition: Condition) => ({
						limit: () =>
							Ref.update(conditions, (all) => [...all, condition]).pipe(
								Effect.as(table === savedView ? [{ id: "custom-view" }] : []),
							),
					}),
				}),
			}),
		});
		return Layer.merge(
			fakeDatabaseSession(database),
			Layer.succeed(RecordedConditions, { conditions: Ref.get(conditions) }),
		);
	}),
);

layer(SavedViewsRepository.layer.pipe(Layer.provideMerge(recordingDatabaseLayer)))((test) => {
	test.effect("selects custom IDs separately from exact kernel and plugin definition owners", () =>
		Effect.gen(function* () {
			const repository = yield* SavedViewsRepository;
			const userId = UserId.make("user-1");
			yield* repository.findByReference(userId, {
				kind: "custom",
				savedViewId: SavedViewId.make("same"),
			});
			yield* repository.findByReference(userId, { slug: "same", kind: "kernel" });
			yield* repository.findByReference(userId, {
				slug: "same",
				kind: "plugin",
				pluginId: PluginId.make("owner-1"),
			});
			const conditions = (yield* (yield* RecordedConditions).conditions)
				.slice(-3)
				.map((condition) => new PgDialect().sqlToQuery(condition));
			expect(conditions[0]?.params).toEqual([userId, false, "same"]);
			expect(conditions[0]?.sql).toContain('"user_saved_view_effective"."id" = $3');
			expect(conditions[1]?.params).toEqual([userId, true, "same"]);
			expect(conditions[1]?.sql).toContain('"user_saved_view_effective"."plugin_id" is null');
			expect(conditions[2]?.params).toEqual([userId, true, "same", "owner-1"]);
			expect(conditions[2]?.sql).toContain('"user_saved_view_effective"."plugin_id" = $4');
		}),
	);
	test.effect("checks custom view references for the exact installation and user", () => {
		const userId = UserId.make("user-1");
		return Effect.gen(function* () {
			const repository = yield* SavedViewsRepository;
			expect(yield* repository.hasCustomInstallationReferences(userId, "installation-id")).toBe(
				true,
			);
			const condition = (yield* (yield* RecordedConditions).conditions).at(-1);
			assert(condition);
			const rendered = new PgDialect().sqlToQuery(condition);
			expect(rendered.sql).toContain('"saved_view"."user_id" = $1');
			expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" = $2');
			expect(rendered.params).toEqual([userId, "installation-id"]);
		});
	});
});

const customRow = (id: string, settings: Record<string, unknown>) => ({
	id,
	settings,
	name: id,
	slug: id,
	icon: "box",
	sortOrder: 0,
	pluginId: null,
	isHidden: false,
	isBuiltin: false,
	dataSources: null,
	pluginInstallationId: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	renderer: { kind: "kernel", name: "entity-browser" },
});

const listingDatabaseLayer = fakeDatabaseSession(
	Object.assign(Object.create(null), {
		select: () => ({
			from: () => ({
				where: () => ({
					orderBy: () =>
						Effect.succeed([customRow("valid", { pageSize: 20 }), customRow("legacy", {})]),
				}),
			}),
		}),
	}),
);

layer(SavedViewsRepository.layer.pipe(Layer.provideMerge(listingDatabaseLayer)))((test) => {
	test.effect("lists views whose settings the renderer schema rejects without decoding them", () =>
		Effect.gen(function* () {
			const repository = yield* SavedViewsRepository;
			const views = yield* repository.listByUser(UserId.make("user-1"), { includeHidden: true });
			expect(views.map(({ slug, settings }) => [slug, settings])).toEqual([
				["valid", { pageSize: 20 }],
				["legacy", {}],
			]);
		}),
	);
});
