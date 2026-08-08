import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	pluginClientFileExtension,
} from "@ryot/contract/modules/plugins/client";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { sortBy } from "@ryot/ts-utils/lodash";
import { Effect } from "effect";
import { parse } from "postcss";

import { compileClientPlugin } from "./compile";
import { isTrustedClientModule, resolveClientPluginCompilerDependencies } from "./dependencies";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";

const fixtureRoot = new URL("../../../plugins/fixture", import.meta.url).pathname;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => encoder.encode(value);
const text = (value: Uint8Array | undefined) => decoder.decode(value);
const fontFamiliesForSelector = (css: string, selector: string) => {
	const values: string[] = [];
	parse(css).walkRules(selector, (rule) => {
		rule.walkDecls("font-family", ({ value }) => {
			values.push(value);
		});
	});
	return values;
};

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
			expect(names.filter((name) => name.startsWith("asset-"))).toHaveLength(12);
			expect(names.filter((name) => name.endsWith(".woff2"))).toHaveLength(9);
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
			expect(css).toContain("font-family: 'Outfit Variable'");
			expect(css).toContain("font-family: 'Lora Variable'");
			expect(fontFamiliesForSelector(css, "body")).toContain("var(--font-family-ui)");
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
	"embeds compiler-owned fonts without a plugin stylesheet",
	() =>
		Effect.gen(function* () {
			const dependencies = yield* resolveClientPluginCompilerDependencies;
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes("export {};"),
			});
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
			const expected = new Map(dependencies.fontAssets.map((file) => [file.name, file]));
			const fonts = artifact.files.filter(({ name }) => name.endsWith(".woff2"));

			expect(fonts).toHaveLength(9);
			expect(css).toContain("font-family: 'Outfit Variable'");
			expect(css).toContain("font-family: 'Lora Variable'");
			expect(fontFamiliesForSelector(css, "body")).toContain("var(--font-family-ui)");
			for (const font of fonts) {
				expect(font.contentType).toBe("font/woff2");
				expect(font.contents).toEqual(expected.get(font.name)?.contents);
				expect(css).toContain(`./${font.name}`);
			}
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

it.effect("reports exact structured TypeScript assignment diagnostics", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": bytes("\nconst value: string = 1;\nconsole.log(value);"),
		}).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual([
			expect.objectContaining({
				line: 2,
				column: 7,
				length: 5,
				code: "TS2322",
				severity: "error",
				file: "client/index.tsx",
			}),
		]);
	}),
);

it.effect("checks unreachable archived TypeScript sources but excludes test sources", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": bytes("export {};"),
			"client/ignored.test.ts": bytes("const ignored: string = 1;"),
			"client/unreachable.ts": bytes("const unreachable: string = 1;"),
		}).pipe(Effect.flip);

		expect(failure.diagnostics).toHaveLength(1);
		expect(failure.diagnostics[0]).toMatchObject({
			code: "TS2322",
			severity: "error",
			file: "client/unreachable.ts",
		});
	}),
);

it.effect("checks archived TypeScript declaration sources", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": bytes("export {};"),
			"client/types.d.ts": bytes("interface Invalid { value: string; value: number; }"),
		}).pipe(Effect.flip);

		expect(failure.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "TS2717",
					severity: "error",
					file: "client/types.d.ts",
				}),
			]),
		);
	}),
);

it.effect("rejects invalid trusted UI SDK JSX props", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": bytes(
				'import { Button } from "@ryot/client-ui-sdk";\nexport const View = () => <Button variant="invalid">Invalid</Button>;',
			),
		}).pipe(Effect.flip);

		expect(
			failure.diagnostics.some(
				({ code, file }) => code === "TS2322" && file === "client/index.tsx",
			),
		).toBe(true);
	}),
);

it.effect(
	"type-checks valid TSX with React, SDK, UI, CSS, and asset imports",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes(`
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot/client-sdk/plugin";
import { Button } from "@ryot/client-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";

const Home = () => {
	const [count, setCount] = useState(0);
	return <Button onClick={() => setCount(count + 1)}><img alt="" src={logo} />{count}</Button>;
};
bootstrapClientPlugin({ home: Home });
`),
				"client/styles.css": bytes(".logo { display: block; }"),
				"client/logo.svg": bytes('<svg xmlns="http://www.w3.org/2000/svg" />'),
			});

			expect(artifact.files.some(({ name }) => name.endsWith(".svg"))).toBe(true);
		}),
	30_000,
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
			const assets = artifact.files.filter(({ name }) => name.endsWith(".png"));

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
			const assets = artifact.files.filter(({ name }) => name.endsWith(".png"));

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
			expect(artifact.files.filter(({ name }) => name.endsWith(".png"))).toHaveLength(0);
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
