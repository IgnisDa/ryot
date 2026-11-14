import { expect } from "bun:test";

import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { measurementSeriesRecipe } from "@ryot-app/fitness-plugin/measurement-recipes";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";

const readings = [
	{ id: "old", properties: { value: 100 }, occurredAt: new Date("2020-01-01T12:00:00Z") },
	{ id: "first", properties: { value: 10 }, occurredAt: new Date("2026-11-02T12:00:00Z") },
	{ id: "second", properties: { value: 20 }, occurredAt: new Date("2026-11-03T12:00:00Z") },
].map((event) =>
	Object.assign({}, event, {
		userId: "owner",
		entityId: "metric",
		eventSchemaPluginId: "fitness",
		eventSchemaSlug: "measurement-reading",
	}),
);
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({ id: "owner", name: "Owner", email: "measurement@test.local" });
			yield* db
				.insert(tables.plugin)
				.values({
					id: "fitness",
					status: "inactive",
					packageId: PluginPackageId.make("ryot/fitness"),
				});
			yield* db
				.insert(tables.entity)
				.values({
					id: "metric",
					name: "Metric",
					userId: "owner",
					entitySchemaPluginId: "fitness",
					entitySchemaSlug: "measurement-metric",
				});
			yield* db.insert(tables.event).values(readings);
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("measurement_grouping")),
	Layer.provide(makeAppConfigLayer()),
);
layer(Layer.effectContext(TestClock.withLive(Layer.build(database))))((test) => {
	test.effect("all-time consistency retains daily observations and normal all-time coarsens", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-11-11T12:00:00Z"));
			const service = yield* RyotQLService;
			const recipe = measurementSeriesRecipe({ reference: { kind: "self" } });
			const document = recipe.document;
			for (const consistency of [true, false]) {
				const response = yield* service.executeForUser(
					"owner",
					null,
					"plugin",
					{
						source: { document, kind: "inline" },
						arguments: {
							consistency,
							range: "all-time",
							metricIds: ["metric"],
							firstAt: "2020-01-01T12:00:00Z",
						},
					},
					"standard",
					undefined,
					{
						pluginId: PluginId.make("fitness"),
						pluginRevisionId: PluginRevisionId.make("revision"),
					},
				);
				const series = Result.getOrThrow(recipe.decode(response));
				expect(series[0]?.points).toEqual(
					consistency
						? [
								{ value: 10, at: "2026-11-02T00:00:00.000Z" },
								{ value: 20, at: "2026-11-03T00:00:00.000Z" },
							]
						: [
								{ value: 100, at: "2019-12-30T00:00:00.000Z" },
								{ value: 15, at: "2026-11-02T00:00:00.000Z" },
							],
				);
			}
		}),
	);
});
