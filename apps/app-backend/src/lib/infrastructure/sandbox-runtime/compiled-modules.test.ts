import { BunServices } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import {
	acquireSandboxCompiledModule,
	garbageCollectSandboxCompiledModules,
	materializeSandboxCompiledModule,
	SandboxCompiledModuleMaterializationError,
} from "./compiled-modules";

const hash = (javascript: string) =>
	new Bun.CryptoHasher("sha256").update(new TextEncoder().encode(javascript)).digest("hex");

const withModuleDirectory = <A, E>(
	use: (
		fs: FileSystem.FileSystem,
		moduleDirectory: string,
	) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-compiled-modules-" });
			const moduleDirectory = path.join(root, "modules");
			yield* fs.makeDirectory(moduleDirectory);
			return yield* use(fs, moduleDirectory);
		}),
	).pipe(Effect.provide(BunServices.layer));

it.effect("materializes exact compiled bytes at a deterministic read-only path", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const javascript = 'export default "first";\n';
			const contentHash = hash(javascript);
			const modulePath = yield* materializeSandboxCompiledModule(
				{ moduleDirectory },
				contentHash,
				javascript,
			);

			expect(modulePath).toBe(`${moduleDirectory}/${contentHash}.mjs`);
			expect(yield* fs.readFileString(modulePath)).toBe(javascript);
			expect((yield* fs.stat(modulePath)).mode & 0o222).toBe(0);
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([`${contentHash}.mjs`]);
		}),
	),
);

it.effect("reuses a verified compiled module without republishing it", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const javascript = "export default 2;\n";
			const contentHash = hash(javascript);
			const firstPath = yield* materializeSandboxCompiledModule(
				{ moduleDirectory },
				contentHash,
				javascript,
			);
			const firstInfo = yield* fs.stat(firstPath);
			const secondPath = yield* materializeSandboxCompiledModule(
				{ moduleDirectory },
				contentHash,
				javascript,
			);

			expect(secondPath).toBe(firstPath);
			expect((yield* fs.stat(secondPath)).ino).toEqual(firstInfo.ino);
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([`${contentHash}.mjs`]);
		}),
	),
);

it.effect("acquires a read-only hard link for an execution scope", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const javascript = "export default 3;\n";
			const contentHash = hash(javascript);
			const canonicalPath = `${moduleDirectory}/${contentHash}.mjs`;
			const executionPath = yield* Effect.scoped(
				Effect.gen(function* () {
					const acquiredPath = yield* acquireSandboxCompiledModule(
						{ moduleDirectory },
						contentHash,
						javascript,
					);

					expect(acquiredPath).not.toBe(canonicalPath);
					expect(acquiredPath.startsWith(`${moduleDirectory}/`)).toBe(true);
					expect(yield* fs.readFileString(acquiredPath)).toBe(javascript);
					expect((yield* fs.stat(acquiredPath)).ino).toEqual((yield* fs.stat(canonicalPath)).ino);
					expect((yield* fs.stat(acquiredPath)).mode & 0o222).toBe(0);
					return acquiredPath;
				}),
			);

			expect(yield* fs.exists(executionPath)).toBe(false);
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([`${contentHash}.mjs`]);
		}),
	),
);

it.effect(
	"keeps an acquired module readable after garbage collection removes its canonical path",
	() =>
		withModuleDirectory((fs, moduleDirectory) =>
			Effect.gen(function* () {
				const javascript = "export default 4;\n";
				const contentHash = hash(javascript);
				const canonicalPath = `${moduleDirectory}/${contentHash}.mjs`;
				const executionPath = yield* Effect.scoped(
					Effect.gen(function* () {
						const acquiredPath = yield* acquireSandboxCompiledModule(
							{ moduleDirectory },
							contentHash,
							javascript,
						);
						yield* garbageCollectSandboxCompiledModules({ moduleDirectory }, new Set());

						expect(yield* fs.exists(canonicalPath)).toBe(false);
						expect(yield* fs.readFileString(acquiredPath)).toBe(javascript);
						return acquiredPath;
					}),
				);

				expect(yield* fs.exists(executionPath)).toBe(false);
				expect(yield* fs.readDirectory(moduleDirectory)).toEqual([]);
			}),
		),
);

it.effect("rejects a supplied hash that does not identify the compiled bytes", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				materializeSandboxCompiledModule(
					{ moduleDirectory },
					hash("different"),
					"export default 3;\n",
				),
			);

			assertExitFails(
				exit,
				new SandboxCompiledModuleMaterializationError({
					message: "Compiled module bytes do not match supplied content hash",
				}),
			);
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([]);
		}),
	),
);

it.effect("rejects a corrupt immutable destination without overwriting it", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const javascript = "export default 4;\n";
			const contentHash = hash(javascript);
			const modulePath = `${moduleDirectory}/${contentHash}.mjs`;
			yield* fs.writeFileString(modulePath, "corrupt");

			const exit = yield* Effect.exit(
				materializeSandboxCompiledModule({ moduleDirectory }, contentHash, javascript),
			);

			assertExitFails(
				exit,
				new SandboxCompiledModuleMaterializationError({
					message: "Compiled module destination contains different bytes",
				}),
			);
			expect(yield* fs.readFileString(modulePath)).toBe("corrupt");
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([`${contentHash}.mjs`]);
		}),
	),
);

it.effect("concurrent materializations converge on one visible module", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const javascript = "export default 5;\n";
			const contentHash = hash(javascript);
			const paths = yield* Effect.all(
				Array.from({ length: 16 }, () =>
					materializeSandboxCompiledModule({ moduleDirectory }, contentHash, javascript),
				),
				{ concurrency: "unbounded" },
			);
			const [modulePath] = paths;
			assert(modulePath);

			expect(new Set(paths)).toEqual(new Set([`${moduleDirectory}/${contentHash}.mjs`]));
			expect(yield* fs.readFileString(modulePath)).toBe(javascript);
			expect((yield* fs.stat(modulePath)).mode & 0o222).toBe(0);
			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([`${contentHash}.mjs`]);
		}),
	),
);

it.effect("removes dead modules while retaining live and unrecognized entries", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const liveHash = hash("live");
			const deadHash = hash("dead");
			const unknownEntries = [
				`${hash("unknown").toUpperCase()}.mjs`,
				`${deadHash}.js`,
				`${deadHash.slice(1)}.mjs`,
				".ryot-compiled-module-temporary",
			];
			yield* fs.writeFileString(`${moduleDirectory}/${liveHash}.mjs`, "live");
			yield* fs.writeFileString(`${moduleDirectory}/${deadHash}.mjs`, "dead");
			for (const entry of unknownEntries.slice(0, 3)) {
				yield* fs.writeFileString(`${moduleDirectory}/${entry}`, "unknown");
			}
			yield* fs.makeDirectory(`${moduleDirectory}/${unknownEntries[3]}`);

			const result = yield* garbageCollectSandboxCompiledModules(
				{ moduleDirectory },
				new Set([liveHash]),
			);

			expect(result).toEqual({ candidateCount: 1, removedCount: 1 });
			expect((yield* fs.readDirectory(moduleDirectory)).sort()).toEqual(
				[`${liveHash}.mjs`, ...unknownEntries].sort(),
			);
		}),
	),
);

it.effect("repeated cleanup is idempotent", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const deadHash = hash("dead");
			yield* fs.writeFileString(`${moduleDirectory}/${deadHash}.mjs`, "dead");

			expect(yield* garbageCollectSandboxCompiledModules({ moduleDirectory }, new Set())).toEqual({
				removedCount: 1,
				candidateCount: 1,
			});
			expect(yield* garbageCollectSandboxCompiledModules({ moduleDirectory }, new Set())).toEqual({
				removedCount: 0,
				candidateCount: 0,
			});
		}),
	),
);

it.effect("concurrent repeated cleanup tolerates already-missing candidates", () =>
	withModuleDirectory((fs, moduleDirectory) =>
		Effect.gen(function* () {
			const deadHash = hash("dead");
			yield* fs.writeFileString(`${moduleDirectory}/${deadHash}.mjs`, "dead");

			yield* Effect.all(
				Array.from({ length: 16 }, () =>
					garbageCollectSandboxCompiledModules({ moduleDirectory }, new Set()),
				),
				{ concurrency: "unbounded" },
			);

			expect(yield* fs.readDirectory(moduleDirectory)).toEqual([]);
		}),
	),
);
