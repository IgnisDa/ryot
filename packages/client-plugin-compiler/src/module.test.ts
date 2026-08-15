import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect } from "effect";

import { clientArtifactMetadata } from "./artifact";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import { compileClientPluginModule } from "./module";

const bytes = (contents: string) => new TextEncoder().encode(contents);
const text = (contents: Uint8Array | undefined) => new TextDecoder().decode(contents);
const assertDefined: <Value>(value: Value | undefined) => asserts value is Value = (value) => {
	expect(value).toBeDefined();
};
const requiredFile = (artifact: PluginClientArtifact, name: string) => {
	const file = artifact.files.find((candidate) => candidate.name === name);
	assertDefined(file);
	return file;
};

it.effect(
	"builds a reusable module with ordered exports, a separate stylesheet, and external dependencies",
	() =>
		Effect.gen(function* () {
			const input = {
				name: "Module plugin",
				pluginDependencies: ["media"],
				apiVersion: CLIENT_API_VERSION,
				publicExports: {
					zulu: { entry: "client/zulu.tsx", kind: "component" as const },
					alpha: { entry: "client/alpha.tsx", kind: "component" as const },
				},
				files: {
					"client/plugin.css": bytes(".module-plugin { color: rebeccapurple; }"),
					"client/zulu.tsx": bytes(
						'import { label } from "../shared/label"; export default function Zulu() { return <p>{label}</p>; }',
					),
					"shared/label.ts": bytes(
						'import { Option } from "@ryot-app/plugin-kit/effect"; export const label = Option.getOrElse(Option.some("neutral shared"), () => "");',
					),
					"client/alpha.tsx": bytes(`
import "./plugin.css";
import { useState } from "react";
import Card from "@ryot-app/plugins/media/show-card";
import "@ryot-app/client-sdk/plugin";
import { label } from "../shared/label";

export default function Alpha() {
	const [count] = useState(1);
	return <Card count={count} label={label} />;
}
`),
				},
			};
			const { artifact } = yield* compileClientPluginModule(input);
			const names = artifact.files.map(({ name }) => name);
			const javascript = text(requiredFile(artifact, "module.js").contents);
			const stylesheet = requiredFile(artifact, "module.css");
			const css = text(stylesheet.contents);
			const imports = [
				...javascript.matchAll(/\bimport\s*(?:[^;\n]*?\bfrom\s*)?["']([^"']+)["']/g),
			].map((match) => match[1]);
			const cssImports = javascript.match(/import\s*["']\.\/module\.css["']/g) ?? [];

			expect(names).toEqual([...names].sort());
			expect(names).toContain("module.js");
			expect(names).toContain("module.css");
			expect(stylesheet.contentType).toBe("text/css; charset=utf-8");
			expect(css).toContain(".module-plugin");
			expect([
				...new Set(
					[...css.matchAll(/@layer ([\w,]+)/g)].flatMap((match) => match[1]?.split(",") ?? []),
				),
			]).toEqual(["properties", "theme", "base", "components", "utilities"]);
			expect(css).not.toContain("@font-face");
			expect(css).not.toContain("--color-red-500:");
			expect(css).not.toContain("--bg:");
			expect(cssImports).toHaveLength(0);
			expect(imports).toEqual(
				expect.arrayContaining([
					"react",
					"react/jsx-runtime",
					"@ryot-app/client-sdk/plugin",
					"@ryot-app/plugins/media/show-card",
				]),
			);
			expect(imports).toContain("@ryot-app/plugin-kit/effect");
			expect(imports).not.toContain("effect");
			expect(javascript).toMatch(/export\{[^}]+as Export0,[^}]+as Export1\}/);
			expect(javascript).not.toContain("function Alpha");
			expect(artifact.apiVersion).toBe(CLIENT_API_VERSION);
			expect(artifact.bridgeVersion).toBe(CLIENT_BRIDGE_PROTOCOL_VERSION);
			expect(artifact.compilerVersion).toBe(CLIENT_COMPILER_VERSION);
			expect(artifact.hash).toBe(clientArtifactMetadata(input.name, artifact.files).hash);
		}),
	60_000,
);

it.effect("reuses package semantic and import-policy validation before building the module", () =>
	Effect.gen(function* () {
		const failure = yield* compileClientPluginModule({
			name: "Invalid module plugin",
			apiVersion: CLIENT_API_VERSION,
			publicExports: { invalid: { kind: "component", entry: "client/invalid.tsx" } },
			files: {
				"client/invalid.tsx": bytes(
					'import "effect"; export default function Invalid() { return null; }',
				),
			},
		}).pipe(Effect.flip);

		expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
		expect(failure.diagnostics[0]?.file).toBe("client/invalid.tsx");
	}),
);

it.effect("checks all archived sources and advertised export types before the module build", () =>
	Effect.gen(function* () {
		const input = {
			name: "Invalid exports",
			apiVersion: CLIENT_API_VERSION,
			publicExports: { home: { kind: "page" as const, entry: "client/home.tsx" } },
			files: {
				"client/home.tsx": bytes(
					"export default function Home(_props: { required: string }) { return null; }",
				),
			},
		};
		const invalidExport = yield* compileClientPluginModule(input).pipe(Effect.flip);
		expect(invalidExport.diagnostics).toEqual(
			expect.arrayContaining([expect.objectContaining({ code: "TS2322" })]),
		);

		const invalidSource = yield* compileClientPluginModule({
			...input,
			files: {
				"shared/unreachable.ts": bytes("const invalid: string = 1;"),
				"shared/ignored.test.ts": bytes("const ignored: string = 1;"),
				"client/home.tsx": bytes("export default function Home() { return null; }"),
			},
		}).pipe(Effect.flip);
		expect(invalidSource.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "TS2322", file: "shared/unreachable.ts" }),
			]),
		);
		expect(invalidSource.diagnostics.some(({ file }) => file === "shared/ignored.test.ts")).toBe(
			false,
		);
	}),
);

it.effect("rejects invalid package source paths and oversized assets during planning", () =>
	Effect.gen(function* () {
		const input = {
			name: "Invalid package",
			apiVersion: CLIENT_API_VERSION,
			publicExports: { home: { kind: "page" as const, entry: "client/home.tsx" } },
			files: { "client/home.tsx": bytes("export default function Home() { return null; }") },
		};
		const pathFailure = yield* compileClientPluginModule({
			...input,
			files: { ...input.files, "client/../secret.ts": bytes("export {};") },
		}).pipe(Effect.flip);
		expect(pathFailure.diagnostics[0]?.code).toBe("RYOT_CLIENT_SOURCE_PATH");
		const assetFailure = yield* compileClientPluginModule({
			...input,
			files: {
				...input.files,
				"client/image.png": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes + 1),
			},
		}).pipe(Effect.flip);
		expect(assetFailure.diagnostics[0]?.code).toBe("RYOT_CLIENT_ASSET_SIZE");
	}),
);

it.effect("emits a minified module with stylesheet asset references resolved", () =>
	Effect.gen(function* () {
		const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01]);
		const { artifact } = yield* compileClientPluginModule({
			name: "Styled plugin",
			apiVersion: CLIENT_API_VERSION,
			publicExports: { home: { kind: "page", entry: "client/home.tsx" } },
			files: {
				"client/image.png": image,
				"client/styles.css": bytes('.plugin-image { background: url("./image.png"); }'),
				"client/home.tsx": bytes(
					'import "./styles.css"; export default function Home() { return <div className="plugin-image">Rendered plugin</div>; }',
				),
			},
		});
		const asset = artifact.files.find(({ name }) => name.endsWith(".png"));
		assertDefined(asset);
		expect(asset.contents).toEqual(image);
		expect(text(requiredFile(artifact, "module.css").contents)).toContain(`./${asset.name}`);
		const javascript = text(requiredFile(artifact, "module.js").contents);
		expect(javascript).toContain("Rendered plugin");
		expect(javascript).not.toContain("function Home");
	}),
);

it.effect(
	"emits deterministic module files",
	() =>
		Effect.gen(function* () {
			const input = {
				name: "CLI test plugin",
				apiVersion: CLIENT_API_VERSION,
				publicExports: { home: { entry: "client/home.tsx", kind: "component" as const } },
				files: {
					"client/styles.css": bytes(".client-test { color: red; }"),
					"shared/util.ts": bytes('export const sharedLabel = "shared";'),
					"client/home.tsx": bytes('const Home = () => "home"; export default Home;'),
				},
			};
			const first = yield* compileClientPluginModule(input);
			const second = yield* compileClientPluginModule(input);
			expect(
				second.artifact.files.map(({ name, contents }) => [name, sha256Hex(contents)]),
			).toEqual(first.artifact.files.map(({ name, contents }) => [name, sha256Hex(contents)]));
			expect(second.artifact.hash).toBe(first.artifact.hash);
		}),
	60_000,
);
