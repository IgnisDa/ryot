import { BunFileSystem } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import type { PluginClientArtifact } from "@ryot-app/client-plugin-contract";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, Layer } from "effect";

import { CLIENT_DEPENDENCY_SPECIFIERS } from "./dependencies";
import { clientPluginCompilerPlatformLayer } from "./platform";
import { buildClientRuntime } from "./runtime";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const reachableChunks = (
	entry: string,
	files: ReadonlyMap<string, string>,
): ReadonlySet<string> => {
	const visited = new Set<string>();
	const chunks = new Set<string>();
	const visit = (name: string) => {
		if (visited.has(name)) {
			return;
		}
		visited.add(name);
		if (name.startsWith("chunk-") && name.endsWith(".js")) {
			chunks.add(name);
		}
		const contents = files.get(name);
		if (contents === undefined) {
			return;
		}
		for (const match of contents.matchAll(
			/(?:^|;)(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["'`](\.\/chunk-[\w-]+\.js)["']/g,
		)) {
			const reference = match[1];
			if (reference) {
				visit(reference.slice(2));
			}
		}
	};
	visit(entry);
	return chunks;
};

const artifactSnapshot = (artifact: PluginClientArtifact) =>
	artifact.files.map(({ name, contents, contentType }) => [
		name,
		contentType,
		Buffer.from(contents).toString("base64"),
	]);

const assertDefined: <Value>(value: Value | undefined) => asserts value is Value = (value) => {
	expect(value).toBeDefined();
};

const emittedRuntime = (javascript: string, css = "") =>
	Layer.merge(
		BunFileSystem.layer,
		Layer.succeed(
			ViteBuildService,
			ViteBuildService.of({
				build: () =>
					Effect.succeed({
						output: [
							...CLIENT_DEPENDENCY_SPECIFIERS.map((_, index) => ({
								type: "chunk",
								code: "export default 1;",
								fileName: `entry-${index}.js`,
							})),
							{ type: "chunk", code: javascript, fileName: "entry-bootstrap.js" },
							{ source: css, type: "asset", fileName: "runtime.css" },
						],
					}),
			}),
		),
	);

it.layer(
	emittedRuntime(
		'const text = `;import "./missing.js"`; /* export * from "./missing.js" */ export default text;',
		'/* url("./missing.png") */',
	),
)("runtime output text", (test) => {
	test.effect("ignores reference-like text in templates and comments", () =>
		Effect.gen(function* () {
			const runtime = yield* buildClientRuntime;
			expect(
				runtime.artifact.files.find((file) => file.name === "entry-bootstrap.js"),
			).toBeDefined();
		}),
	);
});

it.layer(emittedRuntime('export * from "./missing.js";'))("runtime missing import", (test) => {
	test.effect("rejects a real missing re-export", () =>
		Effect.gen(function* () {
			const error = yield* buildClientRuntime.pipe(Effect.flip);
			expect(error.diagnostics[0]?.message).toContain("missing.js");
		}),
	);
});

it.layer(emittedRuntime("export default 1;", '@import url("./missing.css");'))(
	"runtime CSS import",
	(test) => {
		test.effect("rejects a real missing stylesheet import", () =>
			Effect.gen(function* () {
				const error = yield* buildClientRuntime.pipe(Effect.flip);
				expect(error.diagnostics[0]?.message).toContain("missing.css");
			}),
		);
	},
);

it.layer(clientPluginCompilerPlatformLayer)("buildClientRuntime", (test) => {
	test.effect("builds deterministic registry entries with shared React and SDK chunks", () =>
		Effect.gen(function* () {
			const first = yield* buildClientRuntime;
			const second = yield* buildClientRuntime;

			expect(Object.keys(first.entries)).toEqual([...CLIENT_DEPENDENCY_SPECIFIERS, "bootstrap"]);
			for (const [index, specifier] of CLIENT_DEPENDENCY_SPECIFIERS.entries()) {
				const name = first.entries[specifier];
				assertDefined(name);
				expect(name).toBe(`entry-${index}.js`);
				expect(first.artifact.files.find((file) => file.name === name)?.contentType).toMatch(
					/^text\/javascript/,
				);
			}
			const reactEntry = first.entries.react;
			const clsxEntry = first.entries.clsx;
			assertDefined(reactEntry);
			assertDefined(clsxEntry);
			const reactFile = first.artifact.files.find((file) => file.name === reactEntry);
			const clsxFile = first.artifact.files.find((file) => file.name === clsxEntry);
			assertDefined(reactFile);
			assertDefined(clsxFile);
			expect(text(reactFile.contents)).toMatch(/\bdefault\b/);
			expect(text(clsxFile.contents)).toMatch(/\bdefault\b/);
			const bootstrapName = first.entries.bootstrap;
			assertDefined(bootstrapName);
			const bootstrapFile = first.artifact.files.find((file) => file.name === bootstrapName);
			assertDefined(bootstrapFile);
			expect(bootstrapFile.contentType).toMatch(/^text\/javascript/);
			const bootstrapSource = text(bootstrapFile.contents);
			expect(bootstrapSource).toContain("ryot-client-composition");
			expect(bootstrapSource).toMatch(/import\(\w+\)/);
			const staticImports = [
				...bootstrapSource.matchAll(
					/(?:^|;)(?:import|export)\s*(?:[^;]*?\bfrom\s*)?["'`]([^"'`]+)["'`]/g,
				),
			].map((match) => match[1]);
			expect(staticImports.length).toBeGreaterThan(0);
			expect(staticImports.every((specifier) => specifier?.startsWith("./"))).toBe(true);

			const fileContents = new Map(
				first.artifact.files.map(({ name, contents }) => [name, text(contents)]),
			);
			const reactChunks = reachableChunks(reactEntry, fileContents);
			const sdkReactEntry = first.entries["@ryot-app/client-sdk/react"];
			assertDefined(sdkReactEntry);
			const sdkChunks = reachableChunks(sdkReactEntry, fileContents);
			expect([...reactChunks].some((name) => sdkChunks.has(name))).toBe(true);

			const stylesheet = fileContents.get("runtime.css");
			assertDefined(stylesheet);
			expect([
				...new Set(
					[...stylesheet.matchAll(/@layer ([\w,]+)/g)].flatMap(
						(match) => match[1]?.split(",") ?? [],
					),
				),
			]).toEqual(["properties", "theme", "base", "components", "utilities"]);
			expect(stylesheet).toContain("@font-face");
			expect(stylesheet).toContain("--color-red-500:");
			expect(stylesheet).toContain("--bg:");

			expect(second.entries).toEqual(first.entries);
			expect(second.artifact.hash).toBe(first.artifact.hash);
			expect(artifactSnapshot(second.artifact)).toEqual(artifactSnapshot(first.artifact));
		}),
	);
});
