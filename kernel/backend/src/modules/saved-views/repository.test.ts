import { assert, expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { SavedViewsRepository } from "./repository";

it.effect("checks custom view references for the exact installation and user", () => {
	const userId = UserId.make("user-1");
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
	const databaseLayer = Layer.succeed(Database, database);
	return Effect.gen(function* () {
		const repository = yield* SavedViewsRepository;
		expect(yield* repository.hasCustomInstallationReferences(userId, "installation-id")).toBe(true);
		const [condition] = conditions;
		assert(condition);
		const rendered = new PgDialect().sqlToQuery(condition);
		expect(rendered.sql).toContain('"saved_view"."user_id" = $1');
		expect(rendered.sql).toContain('"saved_view"."plugin_installation_id" = $2');
		expect(rendered.params).toEqual([userId, "installation-id"]);
	}).pipe(
		Effect.provide(
			Layer.merge(databaseLayer, SavedViewsRepository.layer.pipe(Layer.provide(databaseLayer))),
		),
	);
});
