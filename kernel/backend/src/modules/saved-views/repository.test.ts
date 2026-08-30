import { assert, expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Ref } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";

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
				from: () => ({
					where: (condition: Condition) => ({
						limit: () =>
							Ref.update(conditions, (all) => [...all, condition]).pipe(
								Effect.as([{ id: "custom-view" }]),
							),
					}),
				}),
			}),
		});
		return Layer.merge(
			Layer.mock(DatabaseSession)({ current: Effect.succeed(database) }),
			Layer.succeed(RecordedConditions, { conditions: Ref.get(conditions) }),
		);
	}),
);

layer(SavedViewsRepository.layer.pipe(Layer.provideMerge(recordingDatabaseLayer)))((test) => {
	test.effect("checks custom view references for the exact installation and user", () => {
		const userId = UserId.make("user-1");
		return Effect.gen(function* () {
			const repository = yield* SavedViewsRepository;
			expect(yield* repository.hasCustomInstallationReferences(userId, "installation-id")).toBe(
				true,
			);
			const [condition] = yield* (yield* RecordedConditions).conditions;
			assert(condition);
			const rendered = new PgDialect().sqlToQuery(condition);
			expect(rendered.sql).toContain('"saved_view"."user_id" = $1');
			expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" = $2');
			expect(rendered.params).toEqual([userId, "installation-id"]);
		});
	});
});
