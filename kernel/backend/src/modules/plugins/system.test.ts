import { BunServices } from "@effect/platform-bun";
import { PluginArchiveError, writePluginArchive } from "@ryot-app/plugin-archive";
import type { Path } from "effect";
import { Effect, FileSystem } from "effect";
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

const writeArchive = Effect.fn("writeArchive")(function* (root: string, slug: string) {
	const fs = yield* FileSystem.FileSystem;
	const manifest = {
		...fixtureManifest(),
		metadata: { ...fixtureManifest().metadata, name: slug, slug },
	};
	yield* fs.writeFile(
		`${root}/${slug}.zip`,
		writePluginArchive({
			manifest,
			files: { "backend/source.ts": new TextEncoder().encode("export const source = true;\n") },
		}),
	);
});

it("discovers valid archives in sorted filename order", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				yield* writeArchive(root, "zeta");
				yield* writeArchive(root, "alpha");
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

it("ignores non-archive entries", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(`${root}/notes.txt`, "ignored");
				yield* fs.makeDirectory(`${root}/directory.zip`);

				expect(yield* discoverSystemPlugins(root)).toEqual([]);
			}),
		),
	));

it("fails discovery for a malformed archive", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString(`${root}/invalid.zip`, "not a zip");
				const result = yield* Effect.result(discoverSystemPlugins(root));

				assert(result._tag === "Failure");
				expect(result.failure).toBeInstanceOf(PluginArchiveError);
				expect(result.failure.reason).toBe("malformed-zip");
			}),
		),
	));
