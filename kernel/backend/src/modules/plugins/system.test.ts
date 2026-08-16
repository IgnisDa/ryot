import { BunServices } from "@effect/platform-bun";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import type { Path } from "effect";
import { Effect, FileSystem, Schema } from "effect";
import { assert, expect, it } from "vitest";

import { discoverSystemPlugins } from "./system";
import { fixtureManifest } from "./test-support";

const withRoot = <A, E>(
	run: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-system-plugins-" });
			return yield* run(root);
		}),
	).pipe(Effect.provide(BunServices.layer));

const writeBundle = Effect.fn("writeBundle")(function* (root: string, directory: string) {
	const fs = yield* FileSystem.FileSystem;
	const bundle = `${root}/${directory}`;
	const manifest = {
		...fixtureManifest(),
		metadata: { ...fixtureManifest().metadata, name: directory, slug: directory },
	};
	yield* fs.makeDirectory(`${bundle}/backend`, { recursive: true });
	yield* fs.writeFileString(
		`${bundle}/manifest.json`,
		yield* Schema.encodeEffect(Schema.fromJsonString(PluginManifest))(manifest),
	);
	yield* fs.writeFileString(`${bundle}/backend/source.ts`, "export const source = true;\n");
});

it("discovers valid bundles in sorted directory order", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				yield* writeBundle(root, "zeta");
				yield* writeBundle(root, "alpha");
				const sources = yield* discoverSystemPlugins(root);

				expect(sources.map(({ manifest }) => manifest.metadata.slug)).toEqual(["alpha", "zeta"]);
				expect(Object.keys(sources[0]?.files ?? {})).toEqual(["backend/source.ts"]);
			}),
		),
	));

it("returns no plugins for absent and empty directories", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				expect(yield* discoverSystemPlugins(`${root}/absent`)).toEqual([]);
				expect(yield* discoverSystemPlugins(root)).toEqual([]);
			}),
		),
	));

it("fails discovery for a malformed bundle manifest", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.makeDirectory(`${root}/invalid`);
				yield* fs.writeFileString(`${root}/invalid/manifest.json`, "{}");
				const result = yield* Effect.result(discoverSystemPlugins(root));

				assert(result._tag === "Failure");
				expect(result.failure.message).toContain("Invalid system plugin manifest");
			}),
		),
	));
