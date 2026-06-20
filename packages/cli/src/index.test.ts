import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const createPlugin = Effect.fn("createPlugin")(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-cli-" });
	const plugin = path.join(root, "plugin");
	const fixture = yield* path.fromFileUrl(
		new URL("../tests/fixtures/valid-plugin/", import.meta.url),
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
		"builds the default output with canonical manifest data and filtered backend files",
		() =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const plugin = yield* createPlugin();
				const result = yield* run(plugin, ["plugin", "build"]);
				const output = path.join(plugin, "dist", "bundle");
				const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PluginManifest))(
					yield* fs.readFileString(path.join(output, "manifest.json")),
				);

				expect(result.exitCode, result.stderr).toBe(0);
				expect(manifest).toMatchObject({
					httpRateLimits: [{ origins: ["https://example.com"] }],
				});
				expect(
					yield* Effect.forEach(manifest.scripts, ({ entry }) =>
						fs.exists(path.join(output, entry)),
					),
				).toEqual(manifest.scripts.map(() => true));
				expect(yield* fs.readFileString(path.join(output, "backend", "main.ts"))).toContain(
					'"initial"',
				);
				expect(
					yield* fs.readFileString(path.join(output, "backend", "nested", "worker.ts")),
				).toContain("worker");
				expect(yield* fs.exists(path.join(output, "backend", "ignored.test.ts"))).toBe(false);
				expect(yield* fs.exists(path.join(output, "client"))).toBe(false);
			}),
	);

	test.effect("builds an explicit output directory", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const result = yield* run(plugin, ["plugin", "build", "--output", "artifacts/plugin"]);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(yield* fs.exists(path.join(plugin, "artifacts", "plugin", "manifest.json"))).toBe(
				true,
			);
			expect(yield* fs.exists(path.join(plugin, "dist", "bundle", "manifest.json"))).toBe(false);
		}),
	);

	test.effect("does not mutate an existing output when the manifest is invalid", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "bundle");
			yield* fs.makeDirectory(output, { recursive: true });
			yield* fs.writeFileString(path.join(output, "sentinel"), "keep");
			yield* fs.writeFileString(
				path.join(plugin, "manifest.ts"),
				"export default { invalid: true };\n",
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(path.join(output, "sentinel"))).toBe("keep");
		}),
	);

	test.effect("does not mutate an existing output when a script is missing", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "bundle");
			yield* fs.makeDirectory(output, { recursive: true });
			yield* fs.writeFileString(path.join(output, "sentinel"), "keep");
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace("backend/main.ts", "backend/missing.ts"),
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(path.join(output, "sentinel"))).toBe("keep");
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
		const output = path.join(plugin, "watch-output");
		const entry = yield* path.fromFileUrl(new URL("./index.ts", import.meta.url));
		const child = yield* spawner.spawn(
			ChildProcess.make(
				process.execPath,
				[entry, "plugin", "build", "--output", output, "--watch"],
				{ cwd: plugin, stderr: "ignore", stdout: "ignore" },
			),
		);
		yield* Effect.addFinalizer(() => child.kill().pipe(Effect.ignore));

		const outputFile = path.join(output, "backend", "main.ts");
		yield* waitFor(fs.exists(outputFile));
		yield* fs.writeFileString(
			path.join(plugin, "backend", "main.ts"),
			'export const main = "updated";\n',
		);
		yield* waitFor(
			Effect.gen(function* () {
				if (!(yield* fs.exists(outputFile))) {
					return false;
				}
				return (yield* fs.readFileString(outputFile)).includes('"updated"');
			}),
		);
	}).pipe(Effect.provide(BunServices.layer)),
);
