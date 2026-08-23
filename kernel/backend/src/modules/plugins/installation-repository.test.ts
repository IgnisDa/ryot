import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { PluginInstallationRepository } from "./installation-repository";

const timestamp = new Date("2026-08-23T12:00:00.000Z");

it.effect("scopes home-view writes to the owning user", () => {
	const updates: Array<Record<string, unknown>> = [];
	const conditions: Array<unknown> = [];
	const db = {
		update: () => ({
			set: (values: Record<string, unknown>) => ({
				where: (condition: unknown) => ({
					returning: () => {
						updates.push(values);
						conditions.push(condition);
						return Effect.succeed([{ id: "installation-id" }]);
					},
				}),
			}),
		}),
	};
	return Effect.gen(function* () {
		const repository = yield* PluginInstallationRepository;
		expect(
			yield* repository.setHomeSavedView(UserId.make("user-id"), "installation-id", "view-id"),
		).toBe(true);
		expect(updates).toEqual([{ homeSavedViewId: "view-id" }]);
		const condition = conditions[0];
		const getSQL =
			typeof condition === "object" && condition !== null
				? Reflect.get(condition, "getSQL")
				: undefined;
		expect(
			typeof getSQL === "function" ? new PgDialect().sqlToQuery(getSQL.call(condition)).params : [],
		).toEqual(["installation-id", "user-id"]);
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				PluginInstallationRepository.layer,
				Layer.succeed(Database, Object.assign(Object.create(null), db)),
			),
		),
	);
});

it.effect("preserves destination system config while restoring private config", () => {
	const updates: Array<Record<string, unknown>> = [];
	const db = {
		insert: () => ({
			values: () => ({
				onConflictDoUpdate: ({ set }: { set: Record<string, unknown> }) => ({
					returning: () => {
						updates.push(set);
						return Effect.succeed([{ id: "installation-id" }]);
					},
				}),
			}),
		}),
	};
	const restore = (preserveExistingConfig: boolean) =>
		Effect.gen(function* () {
			const repository = yield* PluginInstallationRepository;
			yield* repository.restore({
				sortOrder: 0,
				isDisabled: true,
				health: "installing",
				createdAt: timestamp,
				updatedAt: timestamp,
				id: "installation-id",
				pluginId: "plugin-id",
				preserveExistingConfig,
				config: { token: "archived" },
				userId: UserId.make("user-id"),
			});
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					PluginInstallationRepository.layer,
					Layer.succeed(Database, Object.assign(Object.create(null), db)),
				),
			),
		);

	return Effect.gen(function* () {
		yield* restore(true);
		yield* restore(false);
		expect(updates[0]).not.toHaveProperty("config");
		expect(updates[1]).toHaveProperty("config", { token: "archived" });
	});
});
