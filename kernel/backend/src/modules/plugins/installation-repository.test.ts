import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Layer } from "effect";

import { Database } from "#lib/infrastructure/db/service";

import { PluginInstallationRepository } from "./installation-repository";

const timestamp = new Date("2026-08-23T12:00:00.000Z");

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
				preserveExistingConfig,
				id: "installation-id",
				pluginId: "plugin-id",
				userId: UserId.make("user-id"),
				health: "installing",
				isDisabled: true,
				sortOrder: 0,
				config: { token: "archived" },
				createdAt: timestamp,
				updatedAt: timestamp,
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
