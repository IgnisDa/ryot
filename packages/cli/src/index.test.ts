import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { readPluginArchive } from "@ryot/plugin-archive";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const decoder = new TextDecoder();

const createPlugin = Effect.fn("createPlugin")(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-cli-" });
	const plugin = path.join(root, "plugin");
	const fixture = yield* path.fromFileUrl(
		new URL("../tests/fixtures/build-plugin/", import.meta.url),
	);
	yield* fs.copy(fixture, plugin);
	return plugin;
});

const run = Effect.fn("runCli")(function* (cwd: string, args: ReadonlyArray<string>) {
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const entry = yield* path.fromFileUrl(new URL("./index.ts", import.meta.url));
	const child = yield* spawner.spawn(
		ChildProcess.make(process.execPath, [entry, ...args], {
			cwd,
			stderr: "pipe",
			stdout: "ignore",
		}),
	);
	const [exitCode, stderr] = yield* Effect.all(
		[
			child.exitCode,
			child.stderr.pipe(
				Stream.decodeText({ encoding: "utf-8" }),
				Stream.runFold(
					() => "",
					(output, chunk) => output + chunk,
				),
			),
		],
		{ concurrency: "unbounded" },
	);
	return { stderr, exitCode };
});

const waitFor = Effect.fn("waitFor")(function* (
	check: Effect.Effect<boolean, unknown>,
	attempts = 50,
): Effect.fn.Return<void, unknown> {
	if (yield* check) {
		return yield* Effect.void;
	}
	if (attempts === 1) {
		return yield* Effect.fail(new Error("Timed out waiting for CLI output"));
	}
	yield* Effect.sleep("100 millis");
	return yield* waitFor(check, attempts - 1);
});

it.layer(BunServices.layer)("ryot plugin build", (test) => {
	test.effect(
		"builds a deterministic slug archive with canonical manifest data and filtered sources",
		() =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const plugin = yield* createPlugin();
				const assetBytes = new Uint8Array([0xff, 0x00, 0x7f]);
				for (const extension of [
					"png",
					"jpg",
					"jpeg",
					"gif",
					"webp",
					"avif",
					"ico",
					"woff2",
					"wasm",
				]) {
					yield* fs.writeFile(path.join(plugin, "client", `asset.${extension}`), assetBytes);
				}
				yield* fs.writeFile(path.join(plugin, "client", "ignored.PNG"), assetBytes);
				const result = yield* run(plugin, ["plugin", "build"]);
				const output = path.join(plugin, "dist", "cli-test.zip");
				const first = yield* fs.readFile(output);
				const pluginPackage = yield* readPluginArchive(first);
				const secondResult = yield* run(plugin, ["plugin", "build"]);

				expect(result.exitCode, result.stderr).toBe(0);
				expect(secondResult.exitCode, secondResult.stderr).toBe(0);
				expect(yield* fs.readDirectory(path.join(plugin, "dist"))).toEqual(["cli-test.zip"]);
				expect(yield* fs.readFile(output)).toEqual(first);
				expect(pluginPackage.manifest).toMatchObject({
					httpRateLimits: [{ origins: ["https://example.com"] }],
				});
				expect(decoder.decode(pluginPackage.files["backend/main.ts"])).toContain('"initial"');
				expect(decoder.decode(pluginPackage.files["backend/nested/worker.ts"])).toContain("worker");
				expect(pluginPackage.files["backend/ignored.test.ts"]).toBeUndefined();
				expect(Object.keys(pluginPackage.files)).toEqual([
					"backend/main.ts",
					"backend/nested/worker.ts",
					"client/asset.avif",
					"client/asset.gif",
					"client/asset.ico",
					"client/asset.jpeg",
					"client/asset.jpg",
					"client/asset.png",
					"client/asset.wasm",
					"client/asset.webp",
					"client/asset.woff2",
					"client/home.tsx",
					"client/index.tsx",
					"client/logo.svg",
					"client/styles.css",
				]);
				expect(pluginPackage.files["client/asset.png"]).toEqual(assetBytes);
				expect(pluginPackage.files["client/ignored.PNG"]).toBeUndefined();
				expect(pluginPackage.files["client/ignored.test.tsx"]).toBeUndefined();
			}),
	);

	test.effect("builds an explicit output file", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const result = yield* run(plugin, ["plugin", "build", "--output", "artifacts/plugin.zip"]);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(
				(yield* readPluginArchive(yield* fs.readFile(path.join(plugin, "artifacts", "plugin.zip"))))
					.manifest.metadata.slug,
			).toBe("cli-test");
			expect(yield* fs.exists(path.join(plugin, "dist", "cli-test.zip"))).toBe(false);
		}),
	);

	test.effect("does not mutate an existing output when the manifest is invalid", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			yield* fs.writeFileString(
				path.join(plugin, "manifest.ts"),
				"export default { invalid: true };\n",
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect("does not mutate an existing output when a script is missing", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace("backend/main.ts", "backend/missing.ts"),
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect("does not mutate an existing output when a client entry is missing", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace("client/index.tsx", "client/missing.tsx"),
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect("rejects extra commands, arguments, and options", () =>
		Effect.gen(function* () {
			const plugin = yield* createPlugin();
			const results = yield* Effect.forEach(
				[
					["other", "build"],
					["plugin", "other"],
					["plugin", "build", "extra"],
					["plugin", "build", "--unknown"],
				],
				(args) => run(plugin, args),
				{ concurrency: "unbounded" },
			);
			for (const result of results) {
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr).toContain("ERROR");
			}
		}),
	);
});

it.live("rebuilds after a watched backend change", () =>
	Effect.gen(function* () {
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const plugin = yield* createPlugin();
		const output = path.join(plugin, "watch-output.zip");
		const entry = yield* path.fromFileUrl(new URL("./index.ts", import.meta.url));
		const child = yield* spawner.spawn(
			ChildProcess.make(
				process.execPath,
				[entry, "plugin", "build", "--output", output, "--watch"],
				{ cwd: plugin, stderr: "ignore", stdout: "ignore" },
			),
		);
		yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

		yield* waitFor(fs.exists(output));
		yield* fs.writeFileString(
			path.join(plugin, "backend", "main.ts"),
			'export const main = "updated";\n',
		);
		yield* waitFor(
			Effect.gen(function* () {
				if (!(yield* fs.exists(output))) {
					return false;
				}
				const pluginPackage = yield* readPluginArchive(yield* fs.readFile(output));
				return decoder.decode(pluginPackage.files["backend/main.ts"]).includes('"updated"');
			}),
		);
	}).pipe(Effect.provide(BunServices.layer)),
);
