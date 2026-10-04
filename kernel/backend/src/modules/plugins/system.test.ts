import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { PluginArchiveError, writePluginArchive } from "@ryot-app/plugin-archive";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import type { Path } from "effect";
import { Effect, FileSystem, Layer, Schema } from "effect";

import { loadPluginSource } from "./source.test-support";
import { discoverSystemPlugins } from "./system";
import { fixtureManifest, fixturePackageRoot } from "./test-support";

const withRoot = <A, E>(
	run: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | ViteBuildService>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-system-plugins-" });
			return yield* run(root);
		}),
	);

const writeArchive = Effect.fn("writeArchive")(function* (
	root: string,
	name: string,
	publisher = "test",
) {
	const fs = yield* FileSystem.FileSystem;
	const base = fixtureManifest(PluginPackageId.make(`${publisher}/${name}`));
	const manifest = {
		...base,
		metadata: { ...base.metadata, name },
		client: {
			homeView: null,
			apiVersion: 1 as const,
			exports: {
				card: {
					entry: "client/index.ts",
					kind: "component" as const,
					automaticEntityPresentations: false,
				},
			},
		},
	};
	const source = yield* loadPluginSource(fixturePackageRoot(), manifest);
	const compiledManifest = yield* Schema.decodeEffect(PluginManifest)(source.manifest);
	yield* fs.makeDirectory(`${root}/${publisher}`, { recursive: true });
	yield* fs.writeFile(
		`${root}/${publisher}/${name}.zip`,
		writePluginArchive({ ...source, manifest: compiledManifest }),
	);
});

layer(Layer.merge(BunServices.layer, ViteBuildService.layer))((test) => {
	test.effect("discovers valid archives in sorted publisher and filename order", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				yield* writeArchive(root, "zeta", "beta");
				yield* writeArchive(root, "omega", "alpha");
				yield* writeArchive(root, "alpha", "beta");
				const sources = yield* discoverSystemPlugins(root);

				expect(sources.map(({ manifest }) => manifest.metadata.packageId)).toEqual([
					"alpha/omega",
					"beta/alpha",
					"beta/zeta",
				]);
				expect(sources[0]?.compiledScripts.map(({ entry }) => entry)).toEqual([
					"backend/automations/fixture.sandbox.ts",
				]);
				expect(sources[0]?.compiledClient?.hash).toMatch(/^[a-f0-9]{64}$/);
			}),
		),
	);

	test.effect("returns no plugins for absent and empty directories", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				expect(yield* discoverSystemPlugins(`${root}/absent`)).toEqual([]);
				expect(yield* discoverSystemPlugins(root)).toEqual([]);
			}),
		),
	);
	test.effect(
		"rejects duplicate bundled package identities even under different archive filenames",
		() =>
			withRoot((root) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* writeArchive(root, "first");
					yield* fs.writeFile(
						`${root}/test/second.zip`,
						yield* fs.readFile(`${root}/test/first.zip`),
					);
					const result = yield* Effect.result(discoverSystemPlugins(root));
					assert(result._tag === "Failure");
					expect(result.failure).toMatchObject({
						_tag: "PluginValidationError",
						issues: [expect.stringContaining("Duplicate bundled package identity")],
					});
				}),
			),
	);

	test.effect("ignores non-archive entries", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(`${root}/notes.txt`, "ignored");
				yield* fs.writeFileString(`${root}/loose.zip`, "ignored");
				yield* fs.makeDirectory(`${root}/test/directory.zip`, { recursive: true });
				yield* fs.writeFileString(`${root}/test/notes.txt`, "ignored");

				expect(yield* discoverSystemPlugins(root)).toEqual([]);
			}),
		),
	);

	test.effect("fails discovery for a malformed archive", () =>
		withRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.makeDirectory(`${root}/test`);
				yield* fs.writeFileString(`${root}/test/invalid.zip`, "not a zip");
				const result = yield* Effect.result(discoverSystemPlugins(root));

				assert(result._tag === "Failure");
				expect(result.failure).toBeInstanceOf(PluginArchiveError);
				assert(result.failure instanceof PluginArchiveError);
				expect(result.failure.reason).toBe("malformed-zip");
			}),
		),
	);
});
