import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
} from "@ryot/contract/modules/plugins/client";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import { compileClientPlugin } from "./compile";
import { isTrustedClientModule } from "./dependencies";

const fixtureRoot = new URL("../../../plugins/fixture", import.meta.url).pathname;

const fixtureFiles = Effect.promise(async () => {
	const paths = await Array.fromAsync(
		new Bun.Glob("client/**/*.{ts,tsx,css,svg}").scan({ cwd: fixtureRoot, onlyFiles: true }),
	);
	const entries = await Promise.all(
		sortBy(paths).map(
			async (path) => [path, await Bun.file(`${fixtureRoot}/${path}`).text()] as const,
		),
	);
	return Object.fromEntries(entries);
});

const compileFixture = (files: Record<string, string>) =>
	compileClientPlugin({ files, apiVersion: CLIENT_API_VERSION, entry: "client/index.tsx" });

const compileStylesheet = (stylesheet: string, files: Record<string, string> = {}) =>
	compileFixture({
		...files,
		"client/index.tsx": 'import "./styles.css";',
		"client/styles.css": stylesheet,
	});

it.effect(
	"compiles the fixture client sources into a loadable content-addressed artifact",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const { artifact } = yield* compileFixture(files);

			const names = artifact.files.map(({ name }) => name);
			expect(names.filter((name) => name.startsWith("asset-")).length).toBe(1);
			expect(names.at(-1)).toBe("index.html");
			expect(names).toContain("plugin.js");
			expect(names).toContain("plugin.css");

			const byName = new Map(artifact.files.map((file) => [file.name, file]));
			const asset = names.find((name) => name.startsWith("asset-")) ?? "";
			expect(asset).toMatch(/^asset-[a-f0-9]{64}\.svg$/);
			expect(byName.get("plugin.js")?.contentType).toBe("text/javascript; charset=utf-8");
			expect(byName.get("plugin.css")?.contentType).toBe("text/css; charset=utf-8");
			expect(byName.get("index.html")?.contentType).toBe("text/html; charset=utf-8");
			expect(byName.get(asset)?.contentType).toBe("image/svg+xml");
			expect(byName.get(asset)?.contents).toBe(files["client/logo.svg"]);

			const javascript = byName.get("plugin.js")?.contents ?? "";
			expect(javascript).toContain(`"./${asset}"`);
			expect(javascript).not.toContain("@ryot/client-ui-sdk");
			expect(javascript).not.toContain("./styles.css");
			expect(() => Function("document", javascript)({ getElementById: () => null })).not.toThrow();

			const css = byName.get("plugin.css")?.contents ?? "";
			expect(css).toContain(".plugin-logo");
			expect(css).toContain("background-color: var(--accent)");
			expect(css).toContain("color: var(--text-muted)");

			const document = byName.get("index.html")?.contents ?? "";
			expect(document).toContain(`"hash":"${artifact.hash}"`);
			expect(document).toContain('<script type="module" src="./plugin.js">');
			expect(document).toContain('<link rel="stylesheet" href="./plugin.css" />');
			expect(document).toContain('<div id="app">');
			expect(artifact.format).toBe(1);
			expect(artifact.apiVersion).toBe(1);
			expect(artifact.bridgeVersion).toBe(CLIENT_BRIDGE_PROTOCOL_VERSION);
			expect(artifact.compilerVersion).toBe(1);
		}),
	30_000,
);

it.effect(
	"resolves nested stylesheet imports from the plugin client sources",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileStylesheet(
				'@import "tailwindcss";\n@import "./components.css";',
				{
					"client/components.css":
						'@import "./nested/details.css";\n.local-component { color: red; }',
					"client/nested/details.css": ".local-detail { color: blue; }",
				},
			);

			const css = artifact.files.find(({ name }) => name === "plugin.css")?.contents ?? "";
			expect(css).toContain(".local-component");
			expect(css).toContain(".local-detail");
		}),
	30_000,
);

it.effect(
	"does not read an absolute server stylesheet outside the plugin source map",
	() =>
		Effect.gen(function* () {
			const serverStylesheet = `${fixtureRoot}/client/styles.css`;
			const failure = yield* compileStylesheet(`@import ${JSON.stringify(serverStylesheet)};`).pipe(
				Effect.flip,
			);

			expect(failure.diagnostics).toHaveLength(1);
			expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_STYLES");
			expect(failure.diagnostics[0]?.message).toContain(`Stylesheet import "${serverStylesheet}"`);
			expect(failure.diagnostics[0]?.message).toContain("is not allowed");
		}),
	30_000,
);

it.effect(
	"rejects stylesheet imports outside the supported client CSS set",
	() =>
		Effect.gen(function* () {
			for (const specifier of [
				"../../outside.css",
				"@ryot/client-ui-sdk/theme.css",
				"./missing.css",
			]) {
				const failure = yield* compileStylesheet(`@import ${JSON.stringify(specifier)};`).pipe(
					Effect.flip,
				);

				expect(failure.diagnostics).toHaveLength(1);
				expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_STYLES");
				expect(failure.diagnostics[0]?.message).toContain(`Stylesheet import "${specifier}"`);
				expect(failure.diagnostics[0]?.message).toContain("is not allowed");
			}
		}),
	30_000,
);

it.effect(
	"deduplicates identical imported assets",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const home = (files["client/home.tsx"] ?? "")
				.replace(
					'import logo from "./logo.svg";',
					'import logo from "./logo.svg";\nimport logoCopy from "./logo-copy.svg";',
				)
				.replace(
					'<img alt="" src={logo} className="plugin-logo" />',
					'<img alt="" src={logo} className="plugin-logo" /><img alt="" src={logoCopy} />',
				);
			const { artifact } = yield* compileFixture({
				...files,
				"client/home.tsx": home,
				"client/logo-copy.svg": files["client/logo.svg"] ?? "",
			});

			const assets = artifact.files.filter(({ name }) => name.startsWith("asset-"));
			expect(assets).toHaveLength(1);
			expect(assets[0]?.contents).toBe(files["client/logo.svg"]);
			expect(artifact.files.find(({ name }) => name === "plugin.js")?.contents).toContain(
				`"./${assets[0]?.name}"`,
			);
		}),
	30_000,
);

it("trusts only the published client SDK entry points", () => {
	for (const specifier of [
		"@ryot/client-sdk",
		"@ryot/client-sdk/effect",
		"@ryot/client-sdk/plugin",
		"@ryot/client-sdk/react",
		"@ryot/client-ui-sdk",
	]) {
		expect(isTrustedClientModule(specifier)).toBe(true);
	}
	expect(isTrustedClientModule("@ryot/client-sdk/unknown")).toBe(false);
	expect(isTrustedClientModule("@ryot/client-ui-sdk/unknown")).toBe(false);
});

it.effect(
	"derives artifact identity from the compiled client output alone",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const first = yield* compileFixture(files);
			const second = yield* compileFixture(files);
			const changed = yield* compileFixture({
				...files,
				"client/home.tsx": (files["client/home.tsx"] ?? "").replace("Fixture plugin", "Changed"),
			});

			expect(second.artifact.hash).toBe(first.artifact.hash);
			expect(second.artifact.files).toEqual(first.artifact.files);
			expect(changed.artifact.hash).not.toBe(first.artifact.hash);
		}),
	60_000,
);

it.effect(
	"rejects imports outside the trusted client module set",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const failure = yield* compileFixture({
				...files,
				"client/home.tsx": `import "effect";\n${files["client/home.tsx"]}`,
			}).pipe(Effect.flip);

			expect(failure._tag).toBe("ClientPluginCompilerFailure");
			expect(failure.diagnostics).toHaveLength(1);
			expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
			expect(failure.diagnostics[0]?.file).toBe("client/home.tsx");
			expect(failure.diagnostics[0]?.severity).toBe("error");
			expect(failure.diagnostics[0]?.message).toContain('"effect"');
		}),
	30_000,
);
