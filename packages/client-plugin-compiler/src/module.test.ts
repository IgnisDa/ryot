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
				...javascript.matchAll(/^\s*import\s*(?:[^;\n]*?\s*from\s*)?["']([^"']+)["']/gm),
			].map((match) => match[1]);
			const cssImports = javascript.match(/import\s*["']\.\/module\.css["']/g) ?? [];

			expect(names).toEqual([...names].sort());
			expect(names).toContain("module.js");
			expect(names).toContain("module.css");
			expect(stylesheet.contentType).toBe("text/css; charset=utf-8");
			expect(css).toContain(".module-plugin");
			expect(css.indexOf(".module-plugin")).toBeLessThan(css.indexOf("@font-face"));
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
			expect(javascript).toContain("Export0");
			expect(javascript).toContain("Export1");
			expect(javascript).toMatch(/Alpha\s+as\s+Export0/);
			expect(javascript).toMatch(/Zulu\s+as\s+Export1/);
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
