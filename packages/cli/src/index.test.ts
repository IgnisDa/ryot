import { BunServices } from "@effect/platform-bun";
import { expect, it, layer } from "@effect/vitest";
import { PLUGIN_ARCHIVE_LIMITS, readPluginArchive } from "@ryot-app/plugin-archive";
import { Data, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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

const collect = <E>(stream: Stream.Stream<Uint8Array, E>) =>
	stream.pipe(
		Stream.decodeText({ encoding: "utf-8" }),
		Stream.runFold(
			() => "",
			(output, chunk) => output + chunk,
		),
	);

const run = Effect.fn("runCli")(function* (cwd: string, args: ReadonlyArray<string>) {
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const entry = yield* path.fromFileUrl(new URL("./index.ts", import.meta.url));
	const child = yield* spawner.spawn(
		ChildProcess.make(process.execPath, [entry, ...args], { cwd, stderr: "pipe", stdout: "pipe" }),
	);
	const [exitCode, stderr, stdout] = yield* Effect.all(
		[child.exitCode, collect(child.stderr), collect(child.stdout)],
		{ concurrency: "unbounded" },
	);
	return { stdout, stderr, exitCode };
});

class CliOutputTimeout extends Data.TaggedError("CliOutputTimeout")<{ readonly message: string }> {}

const waitFor = Effect.fn("waitFor")(function* <E>(check: Effect.Effect<boolean, E>) {
	for (let attempt = 0; attempt < 150; attempt++) {
		if (yield* check) {
			return yield* Effect.void;
		}
		if (attempt < 149) {
			yield* Effect.sleep("100 millis");
		}
	}
	return yield* new CliOutputTimeout({ message: "Timed out waiting for CLI output" });
});

it.layer(BunServices.layer)("ryot plugin build", (test) => {
	test.effect("preserves generated configuration, OAuth, and executable facts in the archive", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace(
					'configSchema: { fields: {}, unknownKeys: "strict" }',
					'configSchema: { fields: { token: { type: "string", label: "Token", description: "API token" }, threshold: { type: "number", label: "Threshold", description: "Optional threshold" } }, unknownKeys: "strict" }',
				),
			);
			yield* fs.writeFileString(
				path.join(plugin, "backend/main.sandbox.ts"),
				`
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({ kind: "script", slug: "main", name: "Main" });
export default defineScript({ manifest, input: Schema.Unknown, output: Schema.String, run: (_input, host) => Effect.gen(function* () {
  yield* host.getPluginConfig({ required: ["token"], optional: ["threshold"] });
  yield* host.getOAuthAccessToken({ field: "connection" });
  return "ready";
}) });
`,
			);
			yield* fs.writeFileString(
				path.join(plugin, "backend/root.sandbox.ts"),
				`
import { defineManifest, defineWorkflow, defineWorkflowReference, Schema } from "@ryot-app/sandbox-sdk/workflow";
const target = defineWorkflowReference({ workflowSlug: "kernel:event-create", input: Schema.Unknown, output: Schema.String });
export const manifest = defineManifest({ kind: "workflow", slug: "root", name: "Root" });
export default defineWorkflow({ manifest, input: Schema.Unknown, output: Schema.String, run: (input, replay) => replay.child("write", target, input) });
`,
			);
			const result = yield* run(plugin, ["plugin", "build"]);
			expect(result.exitCode, result.stdout + result.stderr).toBe(0);
			const archive = yield* readPluginArchive(
				yield* fs.readFile(path.join(plugin, "dist", "cli-test.zip")),
			);
			expect(archive.manifest.scripts.find(({ slug }) => slug === "main")).toMatchObject({
				executableDependencies: [],
				requiredPluginConfigKeys: ["token"],
				oauthConnectionFields: ["connection"],
				optionalPluginConfigKeys: ["threshold"],
				capabilities: ["getOAuthAccessToken", "getPluginConfig"],
			});
			expect(archive.manifest.scripts.find(({ slug }) => slug === "root")).toMatchObject({
				capabilities: [],
				oauthConnectionFields: [],
				requiredPluginConfigKeys: [],
				optionalPluginConfigKeys: [],
				executableDependencies: [{ kind: "workflow", slug: "kernel:event-create" }],
			});
		}),
	);
	test.effect("preserves policy and after automation metadata in the archive", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			for (const automationType of ["policy", "automation"] as const) {
				const helper = automationType === "policy" ? "defineAutomationPolicy" : "defineAutomation";
				yield* fs.writeFileString(
					path.join(plugin, "backend", `${automationType}.sandbox.ts`),
					`
import { ${helper} } from "@ryot-app/sandbox-sdk/automation";
import { defineManifest } from "@ryot-app/sandbox-sdk/driver";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
export const manifest = defineManifest({
  kind: "automation", automationType: "${automationType}", slug: "${automationType}", name: "${automationType}",
  inputProjection: ${automationType === "policy" ? "{ event: { properties: [] } }" : "{ signal: { properties: [] } }"},
});
export default ${helper}({ manifest, run: () => Effect.succeed(${automationType === "policy" ? '{ action: "allow" as const }' : "null"}) });
`,
				);
			}
			const result = yield* run(plugin, ["plugin", "build"]);
			expect(result.exitCode, result.stdout + result.stderr).toBe(0);
			const archive = yield* readPluginArchive(
				yield* fs.readFile(path.join(plugin, "dist", "cli-test.zip")),
			);
			expect(archive.manifest.scripts.filter(({ kind }) => kind === "automation")).toMatchObject([
				{
					capabilities: [],
					slug: "automation",
					automationType: "automation",
					entry: "backend/automation.sandbox.ts",
					inputProjection: { signal: { properties: [] } },
				},
				{
					slug: "policy",
					capabilities: [],
					automationType: "policy",
					entry: "backend/policy.sandbox.ts",
					inputProjection: { event: { properties: [] } },
				},
			]);
			expect(
				archive.compiledScripts
					.filter(({ entry }) => entry !== "backend/main.sandbox.ts")
					.map(({ entry, format, javascript }) => ({
						entry,
						format,
						javascript: javascript.length > 0,
					})),
			).toEqual([
				{ format: 1, javascript: true, entry: "backend/automation.sandbox.ts" },
				{ format: 1, javascript: true, entry: "backend/policy.sandbox.ts" },
			]);
		}),
	);

	test.effect(
		"builds a deterministic source-free archive with compiled assets and canonical manifest data",
		() =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const plugin = yield* createPlugin();
				const assetBytes = new Uint8Array([0xff, 0x00, 0x7f]);
				const extensions = ["png", "jpg", "jpeg", "gif", "webp", "ico", "woff2", "wasm"];
				for (const extension of extensions) {
					yield* fs.writeFile(
						path.join(plugin, "client", `asset.${extension}`),
						new Uint8Array([...assetBytes, extensions.indexOf(extension)]),
					);
				}
				yield* fs.writeFileString(
					path.join(plugin, "client", "styles.css"),
					extensions
						.map(
							(extension) =>
								`.asset-${extension} { background-image: url("./asset.${extension}"); }`,
						)
						.join("\n"),
				);
				yield* fs.writeFileString(path.join(plugin, "backend", "data.json"), "{}\n");
				const homePath = path.join(plugin, "client", "home.tsx");
				yield* fs.writeFileString(
					homePath,
					`import "./styles.css";\n${yield* fs.readFileString(homePath)}`,
				);
				yield* fs.writeFileString(path.join(plugin, "shared", "data.json"), "{}\n");
				yield* fs.writeFileString(path.join(plugin, "client", "data.json"), "{}\n");
				yield* fs.writeFile(path.join(plugin, "client", "ignored.PNG"), assetBytes);
				const result = yield* run(plugin, ["plugin", "build"]);
				expect(result.exitCode, result.stdout + result.stderr).toBe(0);
				const output = path.join(plugin, "dist", "cli-test.zip");
				const first = yield* fs.readFile(output);
				const pluginPackage = yield* readPluginArchive(first);
				const secondResult = yield* run(plugin, ["plugin", "build"]);
				const compiledClient = pluginPackage.compiledClient;

				expect(secondResult.exitCode, secondResult.stderr).toBe(0);
				expect(compiledClient).toBeDefined();
				expect(compiledClient?.files.map(({ name }) => name)).toContain("module.js");
				expect(compiledClient?.files.map(({ name }) => name)).toContain("module.css");
				expect(yield* fs.readDirectory(path.join(plugin, "dist"))).toEqual(["cli-test.zip"]);
				expect(yield* fs.readFile(output)).toEqual(first);
				expect(pluginPackage.manifest).toMatchObject({
					httpRateLimits: [{ origins: ["https://example.com"] }],
				});
				expect(pluginPackage.compiledScripts).toHaveLength(1);
				expect(pluginPackage.compiledScripts[0]).toMatchObject({
					format: 1,
					entry: "backend/main.sandbox.ts",
				});
				expect(pluginPackage.compiledScripts[0]?.javascript).toContain("initial");
				expect(pluginPackage).not.toHaveProperty("files");
				expect(pluginPackage.compiledScripts[0]).not.toHaveProperty("source");
				for (const extension of extensions) {
					const asset = compiledClient?.files.find(({ name }) => name.endsWith(`.${extension}`));
					const expected = new Uint8Array([...assetBytes, extensions.indexOf(extension)]);
					expect(asset?.contents, extension).toEqual(expected);
				}
				for (const file of compiledClient?.files ?? []) {
					expect(file.name).not.toMatch(/\.(?:map|tsx?|css\.map)$/);
					if (file.contentType.startsWith("text/")) {
						expect(decoder.decode(file.contents)).not.toContain("sourceMappingURL");
					}
				}
				const inlineMap = pluginPackage.compiledScripts[0]?.javascript.match(
					/sourceMappingURL=data:application\/json;base64,([^\s]+)/,
				)?.[1];
				expect(inlineMap).toBeDefined();
				const map = yield* Schema.decodeEffect(
					Schema.fromJsonString(
						Schema.Struct({
							mappings: Schema.String,
							sources: Schema.Array(Schema.String),
							sourcesContent: Schema.optional(Schema.Array(Schema.NullOr(Schema.String))),
						}),
					),
				)(Buffer.from(inlineMap ?? "", "base64").toString("utf-8"));
				expect(map.sources).toContain("backend/main.sandbox.ts");
				expect(map.mappings.length).toBeGreaterThan(0);
				expect(map.sourcesContent).toBeUndefined();
			}),
	);

	test.effect("does not include a compiled client artifact for a backend-only plugin", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace(/\n\tclient: \{[\s\S]*?\n\t\},(?=\n};)/, ""),
			);

			const result = yield* run(plugin, ["plugin", "build"]);
			const pluginPackage = yield* readPluginArchive(
				yield* fs.readFile(path.join(plugin, "dist", "cli-test.zip")),
			);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(pluginPackage.compiledClient).toBeUndefined();
			expect(pluginPackage.compiledScripts).toHaveLength(1);
		}),
	);

	test.effect("writes an empty compiled script list when the backend has no scripts", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace(/\n\tclient: \{[\s\S]*?\n\t\},(?=\n};)/, ""),
			);
			yield* fs.remove(path.join(plugin, "backend", "main.sandbox.ts"));

			const result = yield* run(plugin, ["plugin", "build"]);
			const pluginPackage = yield* readPluginArchive(
				yield* fs.readFile(path.join(plugin, "dist", "cli-test.zip")),
			);

			expect(result.exitCode, result.stderr).toBe(0);
			expect(pluginPackage.manifest.scripts).toEqual([]);
			expect(pluginPackage.compiledScripts).toEqual([]);
			expect(pluginPackage.compiledClient).toBeUndefined();
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

	test.effect(
		"does not mutate an existing output when the archive manifest exceeds its limit",
		() =>
			Effect.gen(function* () {
				const path = yield* Path.Path;
				const fs = yield* FileSystem.FileSystem;
				const plugin = yield* createPlugin();
				const output = path.join(plugin, "dist", "cli-test.zip");
				yield* fs.makeDirectory(path.dirname(output), { recursive: true });
				yield* fs.writeFileString(output, "keep");
				const manifestPath = path.join(plugin, "manifest.ts");
				const manifest = yield* fs.readFileString(manifestPath);
				const longDescription = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.String))(
					"a".repeat(PLUGIN_ARCHIVE_LIMITS.maxManifestBytes),
				);
				yield* fs.writeFileString(
					manifestPath,
					manifest.replace('"A fixture for the CLI tests."', longDescription),
				);

				const result = yield* run(plugin, ["plugin", "build"]);

				expect(result.exitCode).not.toBe(0);
				expect(result.stdout + result.stderr).toContain("manifest-bytes-exceeded");
				expect(yield* fs.readFileString(output)).toBe("keep");
			}),
	);

	test.effect("does not mutate an existing output when a script does not compile", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			const entryPath = path.join(plugin, "backend", "main.sandbox.ts");
			const entry = yield* fs.readFileString(entryPath);
			yield* fs.writeFileString(entryPath, entry.replace("Effect.succeed", "Effect.missing"));

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect(
		"does not mutate an existing output when an advertised client export is missing",
		() =>
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
					manifest.replace("client/home.tsx", "client/missing.tsx"),
				);

				const result = yield* run(plugin, ["plugin", "build"]);

				expect(result.exitCode).not.toBe(0);
				expect(yield* fs.readFileString(output)).toBe("keep");
			}),
	);

	test.effect("does not mutate an existing output when a client source does not type-check", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			const homePath = path.join(plugin, "client", "home.tsx");
			const home = yield* fs.readFileString(homePath);
			yield* fs.writeFileString(homePath, `${home}\nconst mismatch: number = "not a number";\n`);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toMatch(/client\/home\.tsx:\d+:\d+ error/);
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect("validates every advertised export without an authored bootstrap", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const output = path.join(plugin, "dist", "cli-test.zip");
			yield* fs.makeDirectory(path.dirname(output), { recursive: true });
			yield* fs.writeFileString(output, "keep");
			yield* fs.writeFileString(
				path.join(plugin, "client", "home.tsx"),
				"export const Home = () => 'home';\n",
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toContain("error TS1192:");
			expect(yield* fs.readFileString(output)).toBe("keep");
		}),
	);

	test.effect("allows an advertised export to import a declared public plugin dependency", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const manifestPath = path.join(plugin, "manifest.ts");
			const manifest = yield* fs.readFileString(manifestPath);
			yield* fs.writeFileString(
				manifestPath,
				manifest.replace("client: {", 'client: {\n\t\tpluginDependencies: ["media"],'),
			);
			yield* fs.writeFileString(
				path.join(plugin, "client", "home.tsx"),
				'import Card from "@ryot-app/plugins/media/show-card";\nvoid Card;\nexport default function Home() { return null; }\n',
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).toBe(0);
			expect(yield* fs.exists(path.join(plugin, "dist", "cli-test.zip"))).toBe(true);
		}),
	);

	test.effect("rejects an advertised export that imports an undeclared plugin", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			yield* fs.writeFileString(
				path.join(plugin, "client", "home.tsx"),
				'import Card from "@ryot-app/plugins/media/show-card";\nvoid Card;\nexport default function Home() { return null; }\n',
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toContain("authorized export map");
			expect(yield* fs.exists(path.join(plugin, "dist", "cli-test.zip"))).toBe(false);
		}),
	);

	test.effect("fails the build when a manifest value is not a JSON-safe literal", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const fs = yield* FileSystem.FileSystem;
			const plugin = yield* createPlugin();
			const mainPath = path.join(plugin, "backend", "main.sandbox.ts");
			yield* fs.writeFileString(
				path.join(plugin, "backend", "shared.ts"),
				'export const SCRIPT_SLUG = "main" as const;\n',
			);
			const main = yield* fs.readFileString(mainPath);
			yield* fs.writeFileString(
				mainPath,
				`import { SCRIPT_SLUG } from "./shared";\n${main.replace(
					'slug: "main"',
					"slug: SCRIPT_SLUG",
				)}`,
			);

			const result = yield* run(plugin, ["plugin", "build"]);

			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toMatch(
				/backend\/main\.sandbox\.ts:\d+:\d+ error RYOT_MANIFEST: Manifest values must be JSON-safe literals/,
			);
			expect(yield* fs.exists(path.join(plugin, "dist", "cli-test.zip"))).toBe(false);
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

layer(BunServices.layer, { excludeTestServices: true })("ryot plugin build --watch", (test) => {
	test.effect(
		"rebuilds after a watched backend change",
		() =>
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
				const mainPath = path.join(plugin, "backend", "main.sandbox.ts");
				const main = yield* fs.readFileString(mainPath);
				yield* fs.writeFileString(mainPath, main.replace('"initial"', '"updated"'));
				yield* waitFor(
					Effect.gen(function* () {
						if (!(yield* fs.exists(output))) {
							return false;
						}
						const pluginPackage = yield* readPluginArchive(yield* fs.readFile(output));
						return pluginPackage.compiledScripts.some(({ javascript }) =>
							javascript.includes('"updated"'),
						);
					}),
				);
			}),
		60_000,
	);
});
