import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { assert } from "vitest";

import * as schema from "#lib/infrastructure/db/schema/tables/combined";
import { CurrentDb } from "#lib/infrastructure/db/service";

import { PluginRepository } from "./repository";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const makeLayer = (input: {
	statuses?: Array<string>;
	entityRows?: ReadonlyArray<{ id: string }>;
}) => {
	const db = {
		select: () => ({
			from: () => ({
				leftJoin: () => ({
					where: () => ({ limit: () => Promise.resolve(input.entityRows ?? []) }),
				}),
			}),
		}),
		update: () => ({
			set: ({ status }: { status: string }) => ({
				where: () => {
					input.statuses?.push(status);
					return Promise.resolve();
				},
			}),
		}),
	};
	return PluginRepository.Default.pipe(
		Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
	);
};

it.effect("detects entity references to plugin schema slugs", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.hasEntityReferences({
				pluginSlug: "fixture",
				entitySchemaSlugs: ["fixture-entity"],
			}),
		).toBe(true);
	}).pipe(Effect.provide(makeLayer({ entityRows: [{ id: "entity-id" }] }))),
);

it.effect("detects entities referencing a plugin provider", () =>
	Effect.gen(function* () {
		const repository = yield* PluginRepository;
		expect(
			yield* repository.hasEntityReferences({
				pluginSlug: "fixture",
				entitySchemaSlugs: [],
			}),
		).toBe(true);
	}).pipe(Effect.provide(makeLayer({ entityRows: [{ id: "entity-id" }] }))),
);

it.effect(
	"preserves provider IDs and persists provider script membership across reingestion",
	() => {
		const scriptRows: Array<unknown> = [];
		const db = {
			insert: (table: unknown) => ({
				values: (values: unknown) => {
					if (table === schema.sandboxScript && !Array.isArray(values)) {
						scriptRows.push(values);
					}
					return {
						onConflictDoUpdate: () =>
							table === schema.sandboxProvider
								? {
										returning: () =>
											Promise.resolve([{ id: "stable-provider-id", slug: "fixture-provider" }]),
									}
								: Promise.resolve(),
					};
				},
			}),
		};
		const manifest = fixtureManifest();
		const automation = manifest.scripts[0];
		assert(automation);
		const providerScript = {
			...automation,
			kind: "provider" as const,
			name: "Fixture details",
			slug: "fixture.details",
			providerSlug: "fixture-provider",
			providerOperation: "details" as const,
		};
		const customScript = {
			...automation,
			kind: "script" as const,
			name: "Fixture preload",
			slug: "fixture.preload",
			providerSlug: "fixture-provider",
		};
		const plugin: NormalizedPlugin = {
			sourceHash: "source-hash",
			manifest: {
				...manifest,
				scripts: [...manifest.scripts, providerScript, customScript],
				providers: [
					{
						name: "Fixture provider",
						slug: "fixture-provider",
						information: { source: "fixture" },
						operations: { details: providerScript.slug },
					},
				],
			},
			scripts: [automation, providerScript, customScript].map((script) => {
				const { entry, ...metadata } = script;
				return {
					entry,
					metadata,
					slug: script.slug,
					name: script.name,
					source: "source",
					compiledFormat: 1,
					compiledCode: "compiled",
					contentHash: `${script.slug}-hash`,
				};
			}),
		};
		const layer = PluginRepository.Default.pipe(
			Layer.provideMerge(Layer.succeed(CurrentDb, Object.assign(Object.create(null), db))),
		);
		return Effect.gen(function* () {
			const repository = yield* PluginRepository;
			yield* repository.persist(plugin);
			yield* repository.persist({ ...plugin, sourceHash: "updated-source-hash" });
			expect(scriptRows).toEqual([
				expect.objectContaining({ providerId: null, slug: automation.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: providerScript.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: customScript.slug }),
				expect.objectContaining({ providerId: null, slug: automation.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: providerScript.slug }),
				expect.objectContaining({ providerId: "stable-provider-id", slug: customScript.slug }),
			]);
		}).pipe(Effect.provide(layer));
	},
);

it.effect("deactivates a plugin without deleting its script rows", () => {
	const statuses: Array<string> = [];
	return Effect.gen(function* () {
		const repository = yield* PluginRepository;
		yield* repository.deactivate("fixture");
		expect(statuses).toEqual(["inactive"]);
	}).pipe(Effect.provide(makeLayer({ statuses })));
});
