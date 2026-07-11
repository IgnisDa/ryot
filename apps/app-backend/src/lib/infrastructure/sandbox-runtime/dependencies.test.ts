import { FileSystem } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
	ensureSandboxRuntimeDependencies,
	SANDBOX_APPROVED_DEPENDENCIES,
	SANDBOX_RUNTIME_IMPORT_MAP_CONTENT,
} from "./dependencies";

it.scoped("builds exact-version dependency modules in a read-only runtime directory", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-dependencies-" });
		const [runtime, ...concurrentRuntimes] = yield* Effect.all(
			[
				ensureSandboxRuntimeDependencies(root),
				ensureSandboxRuntimeDependencies(root),
				ensureSandboxRuntimeDependencies(root),
				ensureSandboxRuntimeDependencies(root),
			],
			{ concurrency: "unbounded" },
		);
		const cleanupDirectories = [runtime.directory];

		yield* Effect.gen(function* () {
			for (const concurrentRuntime of concurrentRuntimes) {
				expect(concurrentRuntime.directory).toBe(runtime.directory);
			}
			expect(yield* fs.exists(runtime.cacheDirectory)).toBe(true);
			yield* fs.remove(runtime.cacheDirectory, { recursive: true });
			expect((yield* ensureSandboxRuntimeDependencies(root)).directory).toBe(runtime.directory);
			expect(yield* fs.exists(runtime.cacheDirectory)).toBe(true);
			expect(SANDBOX_APPROVED_DEPENDENCIES).toMatchObject([
				{ name: "effect", version: "3.21.4" },
				{ name: "cheerio", version: "1.2.0" },
				{ name: "youtubei", version: "17.2.0" },
				{ name: "fflate", version: "0.8.3" },
				{ name: "papaparse", version: "5.5.3" },
				{ name: "fast-xml-parser", version: "5.8.0" },
			]);
			const importMap = yield* fs.readFileString(runtime.importMapPath);
			expect(importMap).toBe(SANDBOX_RUNTIME_IMPORT_MAP_CONTENT);
			expect(importMap).not.toContain('"npm:');
			expect((yield* fs.readDirectory(runtime.directory)).sort()).toEqual([
				"cheerio-1.2.0.mjs",
				"effect-3.21.4.mjs",
				"fast-xml-parser-5.8.0.mjs",
				"fflate-0.8.3.mjs",
				"import-map.json",
				"papaparse-5.5.3.mjs",
				"youtubei-17.2.0.mjs",
			]);
			const parsedImportMap = yield* Schema.decodeUnknown(
				Schema.parseJson(
					Schema.Struct({ imports: Schema.Record({ key: Schema.String, value: Schema.String }) }),
				),
			)(importMap);
			expect(parsedImportMap.imports["@ryot/sandbox-sdk/effect"]).toBe("./effect-3.21.4.mjs");
			expect(
				Object.values(parsedImportMap.imports).filter((file) => file === "./effect-3.21.4.mjs"),
			).toHaveLength(1);

			const directory = yield* fs.stat(runtime.directory);
			const importMapInfo = yield* fs.stat(runtime.importMapPath);
			expect(directory.mode & 0o222).toBe(0);
			expect(importMapInfo.mode & 0o222).toBe(0);

			for (const dependency of SANDBOX_APPROVED_DEPENDENCIES) {
				const modulePath = `${runtime.directory}/${dependency.runtimeFile}`;
				const module = yield* fs.readFileString(modulePath);
				expect(parsedImportMap.imports[dependency.sdkImport], dependency.name).toBe(
					`./${dependency.runtimeFile}`,
				);
				expect(module.length).toBeGreaterThan(0);
				expect(module).not.toContain("npm:");
				expect(module).not.toContain("@ryot/sandbox-sdk");
				expect((yield* fs.stat(modulePath)).mode & 0o222).toBe(0);
			}

			const primaryModule = `${runtime.directory}/${SANDBOX_APPROVED_DEPENDENCIES[0].runtimeFile}`;
			yield* fs.chmod(primaryModule, 0o644);
			yield* fs.writeFileString(primaryModule, "corrupt");
			const repairedRuntime = yield* ensureSandboxRuntimeDependencies(root);
			cleanupDirectories.push(repairedRuntime.directory);
			expect(repairedRuntime.directory).not.toBe(runtime.directory);
			expect((yield* ensureSandboxRuntimeDependencies(root)).directory).toBe(
				repairedRuntime.directory,
			);

			yield* fs.chmod(repairedRuntime.directory, 0o755);
			yield* fs.writeFileString(`${repairedRuntime.directory}/unexpected.mjs`, "export {};");
			const secondRepair = yield* ensureSandboxRuntimeDependencies(root);
			cleanupDirectories.push(secondRepair.directory);
			expect(secondRepair.directory).not.toBe(repairedRuntime.directory);
			expect((yield* ensureSandboxRuntimeDependencies(root)).directory).toBe(
				secondRepair.directory,
			);

			const youtubeRuntimeFile = SANDBOX_APPROVED_DEPENDENCIES[2].runtimeFile;
			const youtubeModulePath = `${secondRepair.directory}/${youtubeRuntimeFile}`;
			const secondImportMap = yield* fs.readFileString(secondRepair.importMapPath);
			const youtubeModule = yield* fs.readFileString(youtubeModulePath);
			const boundary = secondImportMap.indexOf(youtubeRuntimeFile);
			expect(boundary).toBeGreaterThanOrEqual(0);
			yield* fs.chmod(secondRepair.importMapPath, 0o644);
			yield* fs.chmod(youtubeModulePath, 0o644);
			yield* fs.writeFileString(secondRepair.importMapPath, secondImportMap.slice(0, boundary));
			yield* fs.writeFileString(
				youtubeModulePath,
				`${secondImportMap.slice(boundary + youtubeRuntimeFile.length)}${youtubeRuntimeFile}${youtubeModule}`,
			);
			const boundaryRepair = yield* ensureSandboxRuntimeDependencies(root);
			cleanupDirectories.push(boundaryRepair.directory);
			expect(boundaryRepair.directory).not.toBe(secondRepair.directory);
		}).pipe(
			Effect.ensuring(
				Effect.forEach(cleanupDirectories, (directory) => fs.chmod(directory, 0o755), {
					discard: true,
				}).pipe(Effect.ignore),
			),
		);
	}).pipe(Effect.provide(BunContext.layer)),
);
