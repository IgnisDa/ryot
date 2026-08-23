import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { Effect, Layer } from "effect";

import { ClientPluginCompiler } from "./client-plugin-compiler";
import { compilePluginPackage } from "./pipeline";
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

const compileDependencyImport = (pluginDependencies: readonly string[]) =>
	Effect.gen(function* () {
		const client = {
			homeView: null,
			pluginDependencies,
			apiVersion: 1 as const,
			exports: {
				card: {
					kind: "component" as const,
					entry: "client/dependency.tsx",
					automaticEntityPresentations: false,
				},
			},
		};
		const pluginManifest = { ...fixtureManifest(), client } satisfies PluginManifest;
		const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
		return yield* compilePluginPackage({
			manifest: pluginManifest,
			sourceHash: "source-hash",
			files: {
				...source.files,
				"client/dependency.tsx": new TextEncoder().encode(
					'import Card from "@ryot-app/plugins/media/show-card"; void Card; export default function Dependency() { return null; }',
				),
			},
		});
	}).pipe(Effect.provide(Layer.merge(ClientPluginCompiler.layer, BunFileSystem.layer)));

it.effect(
	"ingests an advertised export that imports a declared plugin dependency",
	() =>
		Effect.gen(function* () {
			const compiled = yield* compileDependencyImport(["media"]);
			expect(compiled).not.toHaveProperty("clientArtifact");
		}),
	30_000,
);

it.effect(
	"rejects ingestion when an advertised export imports an undeclared plugin",
	() =>
		Effect.gen(function* () {
			const failure = yield* compileDependencyImport([]).pipe(Effect.flip);
			expect(
				"diagnostics" in failure &&
					failure.diagnostics.some(
						({ code, message }) =>
							code === "RYOT_CLIENT_IMPORT" && message.includes("authorized export map"),
					),
			).toBe(true);
		}),
	30_000,
);
