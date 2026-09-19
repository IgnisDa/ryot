import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { sandboxRuntimeInputs } from "./inputs";

const limitedPreparation = (
	fixture: (
		root: string,
		runtimeDirectory: string,
	) => Effect.Effect<void, PlatformError, FileSystem.FileSystem>,
	limits: Parameters<typeof sandboxRuntimeInputs>[2],
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-runtime-preparation-" });
		const kernelDirectory = path.join(root, "kernel/backend");
		const runtimeDirectory = path.join(kernelDirectory, "runtime");
		yield* fs.makeDirectory(runtimeDirectory, { recursive: true });
		yield* fixture(root, runtimeDirectory);
		return yield* sandboxRuntimeInputs(kernelDirectory, runtimeDirectory, limits).pipe(Effect.flip);
	});

it.layer(BunServices.layer)("sandboxRuntimeInputs", (test) => {
	test.effect("covers deterministic sandbox runtime preparation inputs", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const compilerDirectory = path.dirname(Bun.fileURLToPath(import.meta.url));
			const kernelDirectory = path.resolve(compilerDirectory, "../../../../kernel/backend");
			const runtimeDirectory = path.join(kernelDirectory, "src/lib/infrastructure/sandbox-runtime");
			const inputs = yield* sandboxRuntimeInputs(kernelDirectory, runtimeDirectory);
			for (const expected of [
				"bun.lock",
				"package.json",
				"kernel/backend/package.json",
				"kernel/backend/tooling/sandbox-runtime.ts",
				"packages/sandbox-compiler/package.json",
				"packages/sandbox-compiler/src/runtime-build/payload.ts",
				"packages/sandbox-compiler/src/runtime-build/inputs.ts",
				"packages/sandbox-compiler/src/runtime-build/registry.ts",
				"packages/sandbox-compiler/src/runtime-build/source-tree.ts",
				"kernel/backend/src/lib/infrastructure/sandbox-runtime/payload.ts",
				"kernel/backend/src/lib/infrastructure/sandbox-runtime/runner-source.sandbox.ts",
				"packages/contract/src/modules/ryotql/language.ts",
				"packages/ryotql/src/index.ts",
				"packages/ryotql-recipes/src/codecs.ts",
				"packages/sandbox-sdk/src/runtime-registry.ts",
				"packages/ts-utils/src/crypto.ts",
				"packages/typescript-compiler/src/index.ts",
				"packages/vite-compiler/src/deno.ts",
				"packages/vite-compiler/package.json",
			]) {
				expect(inputs, expected).toHaveProperty(expected);
			}
			const paths = Object.keys(inputs);
			expect(paths).toEqual([...paths].sort());
			expect(paths.some((entry) => entry.includes("node_modules"))).toBe(false);
			expect(paths.some((entry) => entry.endsWith(".generated.ts"))).toBe(false);
			expect(paths.some((entry) => entry.endsWith(".test.ts"))).toBe(false);
		}),
	);

	test.effect("rejects symbolic links before reading preparation inputs", () =>
		Effect.gen(function* () {
			const failure = yield* limitedPreparation(
				(root, runtimeDirectory) =>
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						const target = `${root}/outside.sandbox.ts`;
						yield* fs.writeFileString(target, "export {};");
						yield* fs.symlink(target, `${runtimeDirectory}/linked.sandbox.ts`);
					}),
				{},
			);
			expect(failure).toMatchObject({ reason: "symbolic-link", _tag: "SourceWalkError" });
			expect(String(failure)).toContain("linked.sandbox.ts");
		}).pipe(Effect.scoped),
	);

	test.effect.each([
		{
			reason: "depth-limit",
			limits: { maxDepth: 0 },
			fixture: (_root: string, runtimeDirectory: string) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.makeDirectory(`${runtimeDirectory}/nested`);
				}),
		},
		{
			reason: "file-limit",
			limits: { maxFiles: 1 },
			fixture: (_root: string, runtimeDirectory: string) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.writeFileString(`${runtimeDirectory}/a.sandbox.ts`, "a");
					yield* fs.writeFileString(`${runtimeDirectory}/b.sandbox.ts`, "b");
				}),
		},
		{
			reason: "size-limit",
			limits: { maxTotalBytes: 1 },
			fixture: (_root: string, runtimeDirectory: string) =>
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.writeFileString(`${runtimeDirectory}/entry.sandbox.ts`, "ab");
				}),
		},
	] as const)("rejects preparation inputs at the $reason", ({ limits, reason, fixture }) =>
		Effect.gen(function* () {
			const failure = yield* limitedPreparation(fixture, limits);
			expect(failure).toMatchObject({ reason, _tag: "SourceWalkError" });
		}).pipe(Effect.scoped),
	);
});
