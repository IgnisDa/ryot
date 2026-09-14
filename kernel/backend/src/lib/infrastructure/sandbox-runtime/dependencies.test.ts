import { BunServices } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { SANDBOX_RUNTIME_REGISTRY } from "@ryot-app/sandbox-sdk/runtime-registry";
import { Effect, Schema, FileSystem } from "effect";

import { materializeShippedSandboxRuntime, materializeSandboxRuntimePayload } from "./dependencies";
import { sandboxRuntimePayload } from "./runtime-payload.generated";

it.effect("builds exact-version dependency modules in a read-only runtime directory", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-dependencies-" });
		const [runtime, ...concurrentRuntimes] = yield* Effect.all(
			[
				materializeShippedSandboxRuntime(root),
				materializeShippedSandboxRuntime(root),
				materializeShippedSandboxRuntime(root),
				materializeShippedSandboxRuntime(root),
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
			expect((yield* materializeShippedSandboxRuntime(root)).directory).toBe(runtime.directory);
			expect(yield* fs.exists(runtime.cacheDirectory)).toBe(true);
			const shippedDependencies = sandboxRuntimePayload.metadata.dependencies;
			const effectDependency = shippedDependencies.find(({ name }) => name === "effect");
			assert(effectDependency);
			expect(shippedDependencies.map(({ name }) => name).sort()).toEqual(
				SANDBOX_RUNTIME_REGISTRY.map(({ name }) => name).sort(),
			);
			const importMap = yield* fs.readFileString(runtime.importMapPath);
			expect(importMap).toBe(
				sandboxRuntimePayload.files.find(({ path }) => path === "import-map.json")?.contents,
			);
			expect(importMap).not.toContain('"npm:');
			expect((yield* fs.readDirectory(runtime.directory)).sort()).toEqual(
				[...sandboxRuntimePayload.files.map(({ path }) => path), "modules"].sort(),
			);
			const parsedImportMap = yield* Schema.decodeEffect(
				Schema.fromJsonString(
					Schema.Struct({ imports: Schema.Record(Schema.String, Schema.String) }),
				),
			)(importMap);
			expect(parsedImportMap.imports["@ryot-app/sandbox-sdk/effect"]).toBe(
				`./${effectDependency.runtimeFile}`,
			);
			expect(
				Object.entries(parsedImportMap.imports)
					.filter(([, file]) => file === `./${effectDependency.runtimeFile}`)
					.map(([specifier]) => specifier)
					.sort(),
			).toEqual(["@ryot-app/plugin-kit/effect", "@ryot-app/sandbox-sdk/effect", "effect"]);

			const directory = yield* fs.stat(runtime.directory);
			const importMapInfo = yield* fs.stat(runtime.importMapPath);
			expect(directory.mode & 0o222).toBe(0);
			expect(importMapInfo.mode & 0o222).toBe(0);

			for (const dependency of shippedDependencies) {
				const modulePath = `${runtime.directory}/${dependency.runtimeFile}`;
				const module = yield* fs.readFileString(modulePath);
				expect(parsedImportMap.imports[dependency.sdkImport], dependency.name).toBe(
					`./${dependency.runtimeFile}`,
				);
				expect(module.length).toBeGreaterThan(0);
				expect(module).not.toContain("npm:");
				if (dependency.name === "youtubei") {
					expect(module).toContain('@ryot-app/sandbox-sdk/effect"');
				} else if (dependency.name === "ryotql") {
					expect(module).toContain('from "effect"');
					expect(module.replaceAll("@ryot-app/sandbox-sdk/effect", "")).not.toContain(
						"@ryot-app/sandbox-sdk",
					);
				} else {
					expect(module).not.toContain("@ryot-app/sandbox-sdk");
				}
				expect((yield* fs.stat(modulePath)).mode & 0o222).toBe(0);
			}

			const primaryDependency = shippedDependencies.find(({ name }) => name === "effect");
			assert(primaryDependency);
			const primaryModule = `${runtime.directory}/${primaryDependency.runtimeFile}`;
			yield* fs.chmod(primaryModule, 0o644);
			yield* fs.writeFileString(primaryModule, "corrupt");
			const repairedRuntime = yield* materializeShippedSandboxRuntime(root);
			cleanupDirectories.push(repairedRuntime.directory);
			expect(repairedRuntime.directory).not.toBe(runtime.directory);
			expect((yield* materializeShippedSandboxRuntime(root)).directory).toBe(
				repairedRuntime.directory,
			);

			yield* fs.chmod(repairedRuntime.directory, 0o755);
			yield* fs.writeFileString(`${repairedRuntime.directory}/unexpected.mjs`, "export {};");
			const secondRepair = yield* materializeShippedSandboxRuntime(root);
			cleanupDirectories.push(secondRepair.directory);
			expect(secondRepair.directory).not.toBe(repairedRuntime.directory);
			expect((yield* materializeShippedSandboxRuntime(root)).directory).toBe(
				secondRepair.directory,
			);

			const youtubeDependency = shippedDependencies.find(({ name }) => name === "youtubei");
			assert(youtubeDependency);
			const youtubeRuntimeFile = youtubeDependency.runtimeFile;
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
			const boundaryRepair = yield* materializeShippedSandboxRuntime(root);
			cleanupDirectories.push(boundaryRepair.directory);
			expect(boundaryRepair.directory).not.toBe(secondRepair.directory);
		}).pipe(
			Effect.ensuring(
				Effect.forEach(cleanupDirectories, (directory) => fs.chmod(directory, 0o755), {
					discard: true,
				}).pipe(Effect.ignore),
			),
		);
	}).pipe(Effect.provide(BunServices.layer)),
);

it.effect("fails clearly for missing and corrupt shipped payloads", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-payload-" });
		const missing = yield* Effect.flip(materializeSandboxRuntimePayload(root, undefined));
		expect(missing.message).toBe("Trusted sandbox runtime payload is missing");

		const corrupt = {
			...sandboxRuntimePayload,
			files: sandboxRuntimePayload.files.map((file, index) =>
				index === 0 ? { ...file, contents: `${file.contents}\ncorrupt` } : file,
			),
		};
		const failure = yield* Effect.flip(materializeSandboxRuntimePayload(root, corrupt));
		expect(failure.message).toContain("payload file is corrupt");

		const invalidLength = {
			...sandboxRuntimePayload,
			metadata: {
				...sandboxRuntimePayload.metadata,
				files: sandboxRuntimePayload.metadata.files.map((file, index) =>
					index === 0 ? Object.assign({}, file, { byteLength: -1 }) : file,
				),
			},
		};
		const invalidMetadata = yield* Effect.flip(
			materializeSandboxRuntimePayload(root, invalidLength),
		);
		expect(invalidMetadata.message).toBe("Trusted sandbox runtime payload metadata is invalid");
	}).pipe(Effect.provide(BunServices.layer)),
);
