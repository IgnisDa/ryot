import { BunServices } from "@effect/platform-bun";
import { PluginArchiveError, writePluginArchive } from "@ryot-app/plugin-archive";
import type { Path } from "effect";
import { Effect, FileSystem } from "effect";
import { assert, expect, it } from "vitest";

import { loadPluginSource } from "./source.test-support";
import { discoverSystemPlugins } from "./system";
import { fixtureManifest, fixturePackageRoot } from "./test-support";

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
	const base = fixtureManifest();
	const manifest = {
		...base,
		metadata: { ...base.metadata, slug, name: slug },
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
	yield* fs.writeFile(`${root}/${slug}.zip`, writePluginArchive({ ...source, manifest }));
});

it("discovers valid archives in sorted filename order", () =>
	Effect.runPromise(
		withRoot((root) =>
			Effect.gen(function* () {
				yield* writeArchive(root, "zeta");
				yield* writeArchive(root, "alpha");
				const sources = yield* discoverSystemPlugins(root);

				expect(sources.map(({ manifest }) => manifest.metadata.slug)).toEqual(["alpha", "zeta"]);
				expect(Object.keys(sources[0]?.files ?? {})).toEqual([
					"backend/automations/fixture.sandbox.ts",
					"backend/bootstrap/user-bootstrap.sandbox.ts",
					"backend/providers/fixture/provider/details.sandbox.ts",
					"backend/providers/fixture/provider/search.sandbox.ts",
					"client/index.ts",
				]);
				expect(sources[0]?.compiledScripts.map(({ entry }) => entry)).toEqual([
					"backend/automations/fixture.sandbox.ts",
				]);
				expect(sources[0]?.compiledClient?.hash).toMatch(/^[a-f0-9]{64}$/);
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
