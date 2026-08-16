import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	pluginClientFileExtension,
} from "@ryot/contract/modules/plugins/client";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";

import { compileClientPlugin } from "./compile";
import { isTrustedClientModule } from "./dependencies";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";

const fixtureRoot = new URL("../../../plugins/fixture", import.meta.url).pathname;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => encoder.encode(value);
const text = (value: Uint8Array | undefined) => decoder.decode(value);

const fixtureFiles = Effect.promise(async () => {
	const paths = await Array.fromAsync(
		new Bun.Glob("client/**/*").scan({ cwd: fixtureRoot, onlyFiles: true }),
	);
	const entries = await Promise.all(
		sortBy(paths.filter((path) => pluginClientFileExtension(path) !== undefined)).map(
			async (path) =>
				[path, new Uint8Array(await Bun.file(`${fixtureRoot}/${path}`).arrayBuffer())] as const,
		),
	);
	return Object.fromEntries(entries);
});

const compileFixture = (files: Record<string, Uint8Array>) =>
	compileClientPlugin({ files, apiVersion: CLIENT_API_VERSION, entry: "client/index.tsx" });

const compileStylesheet = (stylesheet: string, files: Record<string, Uint8Array> = {}) =>
	compileFixture({
		...files,
		"client/index.tsx": bytes('import "./styles.css";'),
		"client/styles.css": bytes(stylesheet),
	});

it.effect(
	"compiles the fixture client sources into a loadable content-addressed artifact",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const { artifact } = yield* compileFixture(files);
			const svgName = `asset-${sha256Hex(files["client/logo.svg"] ?? new Uint8Array())}.svg`;
			const importedPngName = `asset-${sha256Hex(files["client/imported-logo.png"] ?? new Uint8Array())}.png`;
			const cssPngName = `asset-${sha256Hex(files["client/css-logo.png"] ?? new Uint8Array())}.png`;

			const names = artifact.files.map(({ name }) => name);
			expect(names.filter((name) => name.startsWith("asset-"))).toHaveLength(3);
			expect(names.at(-1)).toBe("index.html");
			expect(names).toContain("plugin.js");
			expect(names).toContain("plugin.css");
			expect(names).toEqual(expect.arrayContaining([svgName, importedPngName, cssPngName]));

			const byName = new Map(artifact.files.map((file) => [file.name, file]));
			expect(byName.get("plugin.js")?.contentType).toBe("text/javascript; charset=utf-8");
			expect(byName.get("plugin.css")?.contentType).toBe("text/css; charset=utf-8");
			expect(byName.get("index.html")?.contentType).toBe("text/html; charset=utf-8");
			expect(byName.get(svgName)?.contentType).toBe("image/svg+xml");
			expect(byName.get(importedPngName)?.contentType).toBe("image/png");
			expect(byName.get(cssPngName)?.contentType).toBe("image/png");
			expect(byName.get(svgName)?.contents).toEqual(files["client/logo.svg"]);

			const javascript = text(byName.get("plugin.js")?.contents);
			expect(javascript).toContain(`"./${svgName}"`);
			expect(javascript).toContain(`"./${importedPngName}"`);
			expect(javascript).not.toContain("@ryot/client-ui-sdk");
			expect(javascript).not.toContain("./styles.css");
			// oxlint-disable-next-line typescript/no-implied-eval -- verifies the generated browser module can execute
			expect(() => Function("document", javascript)({ getElementById: () => null })).not.toThrow();

			const css = text(byName.get("plugin.css")?.contents);
			expect(css).toContain(".plugin-logo");
			expect(css).toContain(`./${cssPngName}`);
			expect(css).toContain("background-color: var(--accent)");
			expect(css).toContain("color: var(--text-muted)");

			const document = text(byName.get("index.html")?.contents);
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
					"client/components.css": bytes(
						'@import "./nested/details.css";\n.local-component { color: red; }',
					),
					"client/nested/details.css": bytes(".local-detail { color: blue; }"),
				},
			);

			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
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
			const home = text(files["client/home.tsx"])
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
				"client/home.tsx": bytes(home),
				"client/logo-copy.svg": files["client/logo.svg"] ?? new Uint8Array(),
			});

			const assets = artifact.files.filter(({ name }) => name.endsWith(".svg"));
			expect(assets).toHaveLength(1);
			expect(assets[0]?.contents).toEqual(files["client/logo.svg"]);
			expect(text(artifact.files.find(({ name }) => name === "plugin.js")?.contents)).toContain(
				`"./${assets[0]?.name}"`,
			);
		}),
	30_000,
);

it.effect(
	"imports binary assets without UTF-8 decoding",
	() =>
		Effect.gen(function* () {
			const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes('import image from "./image.png"; console.log(image);'),
				"client/image.png": image,
			});
			const asset = artifact.files.find(({ name }) => name.endsWith(".png"));

			expect(asset?.contents).toEqual(image);
			expect(asset?.contentType).toBe("image/png");
			expect(text(artifact.files.find(({ name }) => name === "plugin.js")?.contents)).toContain(
				`"./${asset?.name}"`,
			);
		}),
	30_000,
);

it.effect("rejects invalid UTF-8 in text sources", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": new Uint8Array([0xff]),
		}).pipe(Effect.flip);

		expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_UTF8");
		expect(failure.diagnostics[0]?.file).toBe("client/index.tsx");
	}),
);

it.effect(
	"rewrites CSS assets relative to root and nested stylesheets",
	() =>
		Effect.gen(function* () {
			const rootImage = new Uint8Array([1, 2, 3]);
			const nestedImage = new Uint8Array([4, 5, 6]);
			const { artifact } = yield* compileStylesheet(
				'@import "./nested/details.css"; .root { background: url("./root.png"); }',
				{
					"client/root.png": rootImage,
					"client/nested/details.css": bytes(".nested { background-image: url(../nested.png); }"),
					"client/nested.png": nestedImage,
				},
			);
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
			const assets = artifact.files.filter(({ name }) => name.startsWith("asset-"));

			expect(assets).toHaveLength(2);
			for (const asset of assets) {
				expect(css).toContain(`./${asset.name}`);
			}
			expect(css).not.toContain("../nested.png");
			expect(css).not.toContain("./root.png");
		}),
	30_000,
);

it.effect(
	"deduplicates an asset imported from JavaScript and CSS",
	() =>
		Effect.gen(function* () {
			const image = new Uint8Array([7, 8, 9]);
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes(
					'import image from "./image.png"; import "./styles.css"; console.log(image);',
				),
				"client/styles.css": bytes(".image { background: url(./image.png); }"),
				"client/image.png": image,
			});
			const assets = artifact.files.filter(({ name }) => name.startsWith("asset-"));

			expect(assets).toHaveLength(1);
			expect(text(artifact.files.find(({ name }) => name === "plugin.js")?.contents)).toContain(
				`./${assets[0]?.name}`,
			);
			expect(text(artifact.files.find(({ name }) => name === "plugin.css")?.contents)).toContain(
				`./${assets[0]?.name}`,
			);
		}),
	30_000,
);

it.effect(
	"rejects invalid local CSS asset URLs",
	() =>
		Effect.gen(function* () {
			for (const [specifier, message] of [
				["./missing.png", "does not exist"],
				["../../outside.png", "traverses outside"],
				["../client/hidden.png", "traverses outside"],
				["/root.png", "root-relative"],
				["./script.ts", "allowed client asset extension"],
			] as const) {
				const failure = yield* compileStylesheet(`.asset { background: url(${specifier}); }`, {
					"client/script.ts": bytes("export {}"),
				}).pipe(Effect.flip);

				expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_STYLES");
				expect(failure.diagnostics[0]?.file).toBe("client/styles.css");
				expect(failure.diagnostics[0]?.message).toContain(message);
			}
		}),
	30_000,
);

it.effect(
	"enforces source and per-asset limits on exact raw byte lengths",
	() =>
		Effect.gen(function* () {
			const prefix = "export {};";
			const exactSource = bytes(
				prefix + " ".repeat(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes - prefix.length),
			);
			const exact = yield* compileFixture({ "client/index.tsx": exactSource });
			expect(exact.artifact.files.at(-1)?.name).toBe("index.html");

			const oversizedSource = yield* compileFixture({
				"client/index.tsx": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes + 1),
			}).pipe(Effect.flip);
			expect(oversizedSource.diagnostics[0]?.code).toBe("RYOT_CLIENT_SOURCE_SIZE");

			const assetPrefix = bytes('import image from "./image.png"; console.log(image);');
			const exactAsset = yield* compileFixture({
				"client/index.tsx": assetPrefix,
				"client/image.png": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes),
			});
			expect(exactAsset.artifact.files.some(({ name }) => name.endsWith(".png"))).toBe(true);

			const oversizedAsset = yield* compileFixture({
				"client/index.tsx": assetPrefix,
				"client/image.png": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes + 1),
			}).pipe(Effect.flip);
			expect(oversizedAsset.diagnostics[0]?.code).toBe("RYOT_CLIENT_ASSET_SIZE");
		}),
	30_000,
);

it.effect(
	"preserves external, data, protocol-relative, and fragment CSS URLs",
	() =>
		Effect.gen(function* () {
			const stylesheet = [
				'url("https://example.com/image.png")',
				"url(data:image/png;base64,iVBORw0KGgo=)",
				"url(//cdn.example.com/image.png)",
				"url(#filter)",
			].join(", ");
			const { artifact } = yield* compileStylesheet(`.asset { background-image: ${stylesheet}; }`);
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);

			expect(css).toContain("https://example.com/image.png");
			expect(css).toContain("data:image/png;base64,iVBORw0KGgo=");
			expect(css).toContain("//cdn.example.com/image.png");
			expect(css).toContain("#filter");
			expect(artifact.files.filter(({ name }) => name.startsWith("asset-"))).toHaveLength(0);
		}),
	30_000,
);

it("trusts only the published client SDK entry points and clsx", () => {
	for (const specifier of [
		"clsx",
		"@ryot/client-sdk",
		"@ryot/client-sdk/effect",
		"@ryot/client-sdk/plugin",
		"@ryot/client-sdk/react",
		"@ryot/client-sdk/ryotql",
		"@ryot/client-ui-sdk",
	]) {
		expect(isTrustedClientModule(specifier)).toBe(true);
	}
	expect(isTrustedClientModule("clsx/lite")).toBe(false);
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
				"client/home.tsx": bytes(
					text(files["client/home.tsx"]).replace("Fixture plugin", "Changed"),
				),
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
				"client/home.tsx": bytes(`import "effect";\n${text(files["client/home.tsx"])}`),
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
