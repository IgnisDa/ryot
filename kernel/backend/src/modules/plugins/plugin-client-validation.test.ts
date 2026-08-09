import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect } from "effect";

import { normalizePluginSource } from "./pipeline";
import { loadPluginSource } from "./source.test-support";
import { fixtureManifest, fixturePackageRoot } from "./test-support";
import { validatePluginSourcePaths } from "./validation";

const manifest = () => ({
	...fixtureManifest(),
	client: {
		homeView: null,
		apiVersion: 1 as const,
		exports: {
			card: {
				entry: "client/card.tsx",
				kind: "component" as const,
				automaticEntityPresentations: false,
			},
		},
	},
});

it.effect("requires every advertised public client export to exist in the package", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(
			validatePluginSourcePaths(
				{
					"client/index.tsx": new Uint8Array(),
					"backend/automations/fixture.sandbox.ts": new Uint8Array(),
				},
				manifest(),
			),
		);
		expect(error.issues).toEqual([
			"Plugin client public export card entry is missing from files: client/card.tsx",
		]);
	}),
);

it.effect("accepts the precompiled client artifact when its content hash matches", () =>
	Effect.gen(function* () {
		const pluginManifest = {
			...fixtureManifest(),
			client: manifest().client,
		} satisfies PluginManifest;
		const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
		const normalized = yield* normalizePluginSource(source);

		expect(normalized.compiledClient?.hash).toBe(source.compiledClient?.hash);
		expect(normalized.sourceHash).toMatch(/^[a-f0-9]{64}$/);
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects a client manifest without its precompiled client artifact", () =>
	Effect.gen(function* () {
		const pluginManifest = {
			...fixtureManifest(),
			client: manifest().client,
		} satisfies PluginManifest;
		const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
		const error = yield* Effect.flip(
			normalizePluginSource({
				files: source.files,
				manifest: pluginManifest,
				compiledScripts: source.compiledScripts,
			}),
		);

		expect(error.issues).toEqual([
			"Plugin client manifest is missing its compiled client artifact",
		]);
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects a precompiled client artifact with an invalid content hash", () =>
	Effect.gen(function* () {
		const pluginManifest = {
			...fixtureManifest(),
			client: manifest().client,
		} satisfies PluginManifest;
		const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
		const compiledClient = source.compiledClient;
		expect(compiledClient).toBeDefined();
		if (!compiledClient) {
			return;
		}
		const error = yield* Effect.flip(
			normalizePluginSource({
				...source,
				compiledClient: { ...compiledClient, hash: "0".repeat(64) },
			}),
		);

		expect(error.issues).toEqual(["Plugin compiled client artifact content hash is invalid"]);
	}).pipe(Effect.provide(BunFileSystem.layer)),
);
