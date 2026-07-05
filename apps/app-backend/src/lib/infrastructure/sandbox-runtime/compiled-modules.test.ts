import { FileSystem, Path } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import {
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
	).pipe(Effect.provide(BunContext.layer));

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
