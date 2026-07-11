import { expect, it } from "@effect/vitest";
import { EntitySchemaSlug, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect, Layer } from "effect";

import { CurrentDb } from "#lib/infrastructure/db/service";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { PluginRuntimeResolver } from "#modules/plugins/runtime-resolver";

import { EntitiesRepository } from "./repository";

const makeDb = () => {
	let row: Record<string, unknown> | undefined;
	let forUpdateCalls = 0;
	const insert = () => ({
		values: (values: Record<string, unknown>) => ({
			onConflictDoNothing: () => ({
				returning: () => {
					if (row) {
						return Promise.resolve([]);
					}

					row = {
						...values,
						id: "entity-1",
						createdAt: new Date("2026-07-20T00:00:00.000Z"),
						updatedAt: new Date("2026-07-20T00:00:00.000Z"),
					};
					return Promise.resolve([row]);
				},
			}),
		}),
	});
	const select = () => ({
		from: () => ({
			where: () => ({
				limit: () => ({
					for: () => {
						forUpdateCalls += 1;
						return Promise.resolve(row ? [row] : []);
					},
				}),
			}),
		}),
	});

	return { db: { insert, select }, getForUpdateCalls: () => forUpdateCalls };
};

it.effect("distinguishes an insert from a locked conflict row", () => {
	const { db, getForUpdateCalls } = makeDb();
	const layer = Layer.mergeAll(
		EntitiesRepository.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					DefinitionRegistry.Default,
					Layer.succeed(PluginRuntimeResolver, {
						_tag: "PluginRuntimeResolver",
						listAutomations: () => Effect.succeed([]),
						findAutomation: () => Effect.succeed(null),
						listSchemaScripts: () => Effect.succeed([]),
						findKernelScript: () => Effect.succeed(null),
						findActiveScript: () => Effect.succeed(null),
						findActiveScriptById: () => Effect.succeed(null),
						findSchemaScriptBySlug: () => Effect.succeed(null),
					}),
				),
			),
		),
		Layer.succeed(CurrentDb, Object.assign(Object.create(null), db)),
	);
	const input = {
		name: "Entity",
		populatedAt: null,
		scope: "global" as const,
		externalId: "external-1",
		properties: { status: "active" },
		sandboxScriptId: SandboxScriptId.make("script-1"),
		entitySchemaSlug: EntitySchemaSlug.make("schema-1"),
	};

	return Effect.gen(function* () {
		const repository = yield* EntitiesRepository;
		const created = yield* repository.insertEntity(input);
		const conflicted = yield* repository.insertEntity(input);

		expect(created.wasInserted).toBe(true);
		expect(conflicted.wasInserted).toBe(false);
		expect(conflicted.entity).toEqual(created.entity);
		expect(getForUpdateCalls()).toBe(1);
	}).pipe(Effect.provide(layer));
});
