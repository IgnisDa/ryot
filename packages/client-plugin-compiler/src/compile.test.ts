import { expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_METADATA_ELEMENT_ID,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	pluginClientFileExtension,
} from "@ryot-app/client-plugin-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { waitFor } from "@testing-library/dom";
import { Effect } from "effect";
import { JSDOM } from "jsdom";
import { parse } from "postcss";

import { compileClientPlugin, type ClientPluginCompilerGraphInput } from "./compile";
import { isTrustedClientModule, resolveClientPluginCompilerDependencies } from "./dependencies";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";

const fixtureRoot = new URL("../../../plugins/fixture", import.meta.url).pathname;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => encoder.encode(value);
const text = (value: Uint8Array | undefined) => decoder.decode(value);
const bindingPattern = (binding: string) => binding.replaceAll("$", "\\$");
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
	const files: Record<string, Uint8Array> = Object.fromEntries(entries);
	files["client/index.tsx"] = bytes(`
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { Home } from "./home";
bootstrapClientPlugin({ home: { component: Home } });
`);
	return files;
});

const compileFixture = (files: Record<string, Uint8Array>) =>
	compileClientPlugin({
		files,
		name: "Fixture plugin",
		entry: "client/index.tsx",
		apiVersion: CLIENT_API_VERSION,
	});

const compileGraph = (overrides: Partial<ClientPluginCompilerGraphInput> = {}) => {
	const contributors = overrides.contributors ?? {
		user: {
			files: { "client/page.tsx": bytes("export default function Page() { return null; }") },
		},
	};
	return compileClientPlugin({
		contributors,
		publicExports: {},
		application: "page",
		name: "Composed page",
		apiVersion: CLIENT_API_VERSION,
		entry: { contributor: "user", path: "client/page.tsx" },
		contributorOrder: overrides.contributorOrder ?? Object.keys(contributors),
		...overrides,
	});
};

const compileStylesheet = (stylesheet: string, files: Record<string, Uint8Array> = {}) =>
	compileFixture({
		...files,
		"client/index.tsx": bytes('import "./styles.css";'),
		"client/styles.css": bytes(stylesheet),
	});

it.effect("generates and executes the single bootstrap for a saved-view page", () =>
	Effect.gen(function* () {
		const { artifact } = yield* compileClientPlugin({
			name: "User page",
			application: "page",
			entry: "client/page.tsx",
			apiVersion: CLIENT_API_VERSION,
			files: {
				"client/page.tsx": bytes(`
import { usePageContext } from "@ryot-app/client-sdk/plugin";
export default function Page() {
  const { settings } = usePageContext();
  return <div>Published user page: {String(settings.title ?? "")}</div>;
}
`),
			},
		});
		const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
		expect(javascript).toContain("Published user page");
		expect(javascript).not.toContain("@ryot-app/client-sdk/plugin");
		// oxlint-disable-next-line typescript/no-implied-eval -- verifies the generated page module executes
		expect(() => Function("document", javascript)({ getElementById: () => null })).not.toThrow();
	}),
);

it.effect(
	"compiles the fixture client sources into a loadable content-addressed artifact",
	() =>
		Effect.gen(function* () {
			const files = yield* fixtureFiles;
			const hotkeyFiles = {
				...files,
				"client/home.tsx": bytes(
					text(files["client/home.tsx"])
						.replace(
							"import { Button, StatusMessage }",
							"import { Button, StatusMessage, useShortcut }",
						)
						.replace(
							"export const Home = () => {",
							'export const Home = () => {\n\tuseShortcut("Mod+K", () => {});',
						),
				),
			};
			const { artifact } = yield* compileFixture(hotkeyFiles);
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
			expect(javascript).not.toContain("@ryot-app/client-ui-sdk");
			expect(javascript).not.toContain("./styles.css");
			// Bun can emit this imported hook call without declaring its minified binding.
			const hotkeyBinding = javascript.match(
				/\b([A-Za-z_$][\w$]*)\([^)]*,[^)]*,\{stopPropagation:!1,conflictBehavior:"allow"/,
			)?.[1];
			if (hotkeyBinding === undefined) {
				throw new Error("Expected the generated useHotkey call");
			}
			const coreHotkeyBindings = javascript
				.match(
					new RegExp(
						`function\\s+${hotkeyBinding}\\([^)]*\\)\\{.*?,[A-Za-z_$][\\w$]*=([A-Za-z_$][\\w$]*)\\(\\),.*?,[A-Za-z_$][\\w$]*=([A-Za-z_$][\\w$]*)\\([^,]+,[^?]+\\?\\?([A-Za-z_$][\\w$]*)\\(\\)\\)`,
					),
				)
				?.slice(1);
			if (coreHotkeyBindings === undefined) {
				throw new Error("Expected the generated core hotkey calls");
			}
			for (const binding of [hotkeyBinding, ...coreHotkeyBindings]) {
				expect(javascript).toMatch(
					new RegExp(
						`\\b(?:function\\s+${bindingPattern(binding)}\\b|${bindingPattern(binding)}\\s*=)`,
					),
				);
			}
			const hotkeyManagerStoreBinding = javascript.match(
				/this\.registrations=new ([A-Za-z_$][\w$]*)\(new Map\)/,
			)?.[1];
			if (hotkeyManagerStoreBinding === undefined) {
				throw new Error("Expected the generated HotkeyManager Store construction");
			}
			expect(javascript).toMatch(
				new RegExp(
					`\\b(?:function\\s+${bindingPattern(hotkeyManagerStoreBinding)}\\b|${bindingPattern(hotkeyManagerStoreBinding)}\\s*=)`,
				),
			);
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
			expect(css).toContain("--accent: #fd7e14");
			expect(css).toContain("prefers-color-scheme: dark");
			expect(css).toContain('[data-theme="dark"]');

			const document = text(byName.get("index.html")?.contents);
			expect(document).toContain("<title>Fixture plugin</title>");
			expect(document).toContain(`"hash":"${artifact.hash}"`);
			expect(document).toContain('<script type="module" src="./plugin.js">');
			expect(document).toContain('<link rel="stylesheet" href="./plugin.css" />');
			expect(document).toContain('<div id="app">');
			expect(artifact.format).toBe(1);
			expect(artifact.apiVersion).toBe(CLIENT_API_VERSION);
			expect(artifact.bridgeVersion).toBe(CLIENT_BRIDGE_PROTOCOL_VERSION);
			expect(artifact.compilerVersion).toBe(CLIENT_COMPILER_VERSION);
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
	"injects the Tailwind entry once for a plugin without a stylesheet",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileFixture({ "client/index.tsx": bytes("export {};") });
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);

			expect(css).toContain("box-sizing: border-box");
			expect(css).toContain("outline: 2px solid var(--focus)");
			expect(css).toContain("cursor: pointer");
			expect(css.match(/box-sizing: border-box/g)).toHaveLength(1);
		}),
	30_000,
);

it.effect(
	"does not duplicate the Tailwind entry a plugin stylesheet also imports",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileStylesheet(
				'@import "tailwindcss";\n.local { color: red; }',
			);
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);

			expect(css).toContain(".local");
			expect(css.match(/box-sizing: border-box/g)).toHaveLength(1);
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
				"@ryot-app/client-ui-sdk/theme.css",
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

it.effect(
	"generates one page bootstrap while validating every advertised package page",
	() =>
		Effect.gen(function* () {
			const input = {
				name: "Exporting plugin",
				entry: "client/index.tsx",
				apiVersion: CLIENT_API_VERSION,
				publicExports: {
					"entity-detail": { entry: "client/entity-detail.tsx", kind: "page" as const },
					"route-page": { entry: "client/route-page.tsx", kind: "page" as const },
				},
				files: {
					"client/index.tsx": bytes("export {};"),
					"client/entity-detail.tsx": bytes(
						'Reflect.set(globalThis, "generatedPageRoots", Number(Reflect.get(globalThis, "generatedPageRoots") ?? 0) + 1); export default function EntityDetail() { return <div>entity-detail-page</div>; }',
					),
					"client/route-page.tsx": bytes(
						"export default function RoutePage() { return <div>ordinary-route-page</div>; }",
					),
				},
			};
			const { artifact } = yield* compileClientPlugin(input);
			const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
			expect(javascript).toContain("entity-detail-page");
			expect(javascript).not.toContain("ordinary-route-page");
			// oxlint-disable-next-line typescript/no-implied-eval -- verifies one generated page root executes
			Function("document", javascript)({ getElementById: () => null });
			expect(Reflect.get(globalThis, "generatedPageRoots")).toBe(1);
			Reflect.deleteProperty(globalThis, "generatedPageRoots");

			const missingDefault = yield* compileClientPlugin({
				...input,
				files: {
					...input.files,
					"client/route-page.tsx": bytes("export const RoutePage = () => null;"),
				},
			}).pipe(Effect.flip);
			expect(missingDefault.diagnostics[0]).toMatchObject({ code: "RYOT_CLIENT_BUNDLE" });
			expect(missingDefault.diagnostics[0]?.message).toContain("No matching export");

			const wrongPageType = yield* compileClientPlugin({
				...input,
				files: {
					...input.files,
					"client/route-page.tsx": bytes(
						"export default function RoutePage(_props: { required: string }) { return null; }",
					),
				},
			}).pipe(Effect.flip);
			expect(wrongPageType.diagnostics).toEqual(
				expect.arrayContaining([expect.objectContaining({ code: "TS2345" })]),
			);
		}),
	30_000,
);

it.effect("enforces client import policy for otherwise unreachable advertised exports", () =>
	Effect.gen(function* () {
		const failure = yield* compileClientPlugin({
			name: "Exporting plugin",
			entry: "client/index.tsx",
			apiVersion: CLIENT_API_VERSION,
			publicExports: { summary: { entry: "client/summary.tsx", kind: "component" } },
			files: {
				"client/index.tsx": bytes("export {};"),
				"client/summary.tsx": bytes(
					'import { Option } from "@ryot-app/plugin-kit/effect"; export default function Summary() { return Option.none(); }',
				),
			},
		}).pipe(Effect.flip);

		expect(failure.diagnostics[0]).toMatchObject({
			code: "RYOT_CLIENT_IMPORT",
			file: "client/summary.tsx",
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
				'import { Button } from "@ryot-app/client-ui-sdk";\nexport const View = () => <Button variant="invalid">Invalid</Button>;',
			),
		}).pipe(Effect.flip);

		expect(
			failure.diagnostics.some(
				({ code, file }) => code === "TS2322" && file === "client/index.tsx",
			),
		).toBe(true);
	}),
);

it.effect("executes the trusted UI table subpath without missing transitive bindings", () =>
	Effect.gen(function* () {
		const { artifact } = yield* compileFixture({
			"client/index.tsx": bytes(`
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { DataTable, type DataTableColumn } from "@ryot-app/client-ui-sdk/table";
import { Component, type ReactNode } from "react";

type Item = { readonly id: string; readonly label: string };
type BoundaryProps = { readonly children: ReactNode };
type BoundaryState = { readonly error: string | null };
class Boundary extends Component<BoundaryProps, BoundaryState> {
  state = { error: null };
  static getDerivedStateFromError(error: unknown) { return { error: String(error) }; }
  render() { return this.state.error === null ? this.props.children : <p>{this.state.error}</p>; }
}
const columns: ReadonlyArray<DataTableColumn<Item>> = [
	{ id: "label", header: "Label", cell: (item) => item.label },
];
const Home = () => (
  <Boundary>
    <DataTable data={[{ id: "one", label: "One" }]} columns={columns} getRowId={(item) => item.id} />
  </Boundary>
);
bootstrapClientPlugin({ home: { component: Home } });
`),
		});

		const dom = new JSDOM(
			'<!doctype html><html><head></head><body><div id="app"></div></body></html>',
			{
				url: "https://fixture.test",
			},
		);
		const { document, window } = dom.window;
		const metadata = document.createElement("script");
		metadata.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
		metadata.textContent = JSON.stringify({
			hash: artifact.hash,
			format: artifact.format,
			apiVersion: artifact.apiVersion,
			bridgeVersion: artifact.bridgeVersion,
			compilerVersion: artifact.compilerVersion,
		});
		document.head.append(metadata);
		let initialize: EventListener | undefined;
		const addEventListener = window.addEventListener.bind(window);
		window.addEventListener = ((
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		) => {
			if (type === "message" && initialize === undefined) {
				initialize =
					typeof listener === "function" ? listener : (event) => listener.handleEvent(event);
				return;
			}
			addEventListener(type, listener, options);
		}) as typeof window.addEventListener;
		const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
		const execute = () =>
			// oxlint-disable-next-line typescript/no-implied-eval -- executes the emitted application
			Function(
				"window",
				"document",
				"AbortController",
				javascript,
			)(window, document, window.AbortController);
		expect(execute).not.toThrow();
		expect(initialize).toBeDefined();
		const channel = new MessageChannel();
		let ready = false;
		channel.port1.addEventListener("message", (event) => {
			if (event.data?.artifactHash === artifact.hash) {
				ready = true;
			}
		});
		channel.port1.start();
		const pluginPort = {
			start: () => channel.port2.start(),
			close: () => channel.port2.close(),
			postMessage: (message: unknown) => channel.port2.postMessage(message),
			addEventListener: (
				type: "message",
				listener: EventListener,
				options?: AddEventListenerOptions,
			) => {
				channel.port2.addEventListener(type, listener);
				options?.signal?.addEventListener("abort", () =>
					channel.port2.removeEventListener(type, listener),
				);
			},
		};
		const initEvent = new window.Event("message");
		Object.defineProperties(initEvent, {
			ports: { value: [pluginPort] },
			source: { value: window.parent },
			data: {
				value: {
					mode: "light",
					safeAreaTop: 0,
					safeAreaBottom: 0,
					sessionId: "session-1",
					format: artifact.format,
					artifactHash: artifact.hash,
					apiVersion: artifact.apiVersion,
					bridgeVersion: artifact.bridgeVersion,
					compilerVersion: artifact.compilerVersion,
				},
			},
		});
		initialize?.(initEvent);
		yield* Effect.promise(() =>
			waitFor(() => expect(ready).toBe(true), { container: document.body }),
		);
		channel.port1.postMessage({
			index: 0,
			key: "home",
			compact: false,
			edgeBack: false,
			type: "location",
			leading: "drawer",
			location: { kind: "route", path: "/", search: "" },
		});
		yield* Effect.promise(() =>
			waitFor(() => expect(document.getElementById("app")?.textContent).toContain("One"), {
				container: document.body,
			}),
		);
		channel.port1.close();
		channel.port2.close();
		dom.window.close();
	}),
);

it.effect("type-checks and bundles the trusted UI icon subpath", () =>
	Effect.gen(function* () {
		const { artifact } = yield* compileFixture({
			"client/index.tsx": bytes(`
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";

const Home = () => <AppIcon name="menu" size={22} />;
bootstrapClientPlugin({ home: { component: Home } });
`),
		});

		const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
		// The registry names every icon, so a linked barrel carries the path data of one it never renders.
		expect(javascript).toContain("M18 6 6 18");
		// oxlint-disable-next-line typescript/no-implied-eval -- the icon barrel must link, not dangle
		expect(() => Function("document", javascript)({ getElementById: () => null })).not.toThrow();
	}),
);

it.effect(
	"type-checks valid TSX with React, SDK, UI, CSS, and asset imports",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes(`
import "./styles.css";
import { bootstrapClientPlugin } from "@ryot-app/client-sdk/plugin";
import { Button } from "@ryot-app/client-ui-sdk";
import { useState } from "react";
import logo from "./logo.svg";

const Home = () => {
	const [count, setCount] = useState(0);
	return <Button onClick={() => setCount(count + 1)}><img alt="" src={logo} />{count}</Button>;
};
bootstrapClientPlugin({ home: { component: Home } });
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
	"enforces source and per-asset limits on eligible client and shared bytes alone",
	() =>
		Effect.gen(function* () {
			const prefix = "export {};";
			const exactSource = bytes(
				prefix + " ".repeat(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes - prefix.length),
			);
			const exact = yield* compileFixture({ "client/index.tsx": exactSource });
			expect(exact.artifact.files.at(-1)?.name).toBe("index.html");

			const archived = yield* compileFixture({
				"client/index.tsx": exactSource,
				"backend/invalid.ts": bytes("const invalid: string = 1;"),
				"backend/bulk.ts": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes),
			});
			expect(archived.artifact.files.at(-1)?.name).toBe("index.html");

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
		"@ryot-app/client-sdk",
		"@ryot-app/client-sdk/effect",
		"@ryot-app/client-sdk/plugin",
		"@ryot-app/client-sdk/react",
		"@ryot-app/client-sdk/ryotql",
		"@ryot-app/client-ui-sdk",
		"@ryot-app/client-ui-sdk/icon",
		"@ryot-app/client-ui-sdk/tint",
		"@ryot-app/client-ui-sdk/table",
		"@ryot-app/client-ui-sdk/schema-form",
	]) {
		expect(isTrustedClientModule(specifier)).toBe(true);
	}
	expect(isTrustedClientModule("clsx/lite")).toBe(false);
	expect(isTrustedClientModule("@ryot-app/client-sdk/unknown")).toBe(false);
	expect(isTrustedClientModule("@ryot-app/client-ui-sdk/unknown")).toBe(false);
	expect(isTrustedClientModule("@tanstack/react-table")).toBe(false);
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

it.effect(
	"titles the plugin document with the manifest name and folds the name into artifact identity",
	() =>
		Effect.gen(function* () {
			const files = { "client/index.tsx": bytes("export {};") };
			const plain = yield* compileClientPlugin({
				files,
				name: "Anime & Manga",
				apiVersion: CLIENT_API_VERSION,
				entry: "client/index.tsx",
			});
			const other = yield* compileClientPlugin({
				files,
				name: "Fitness",
				apiVersion: CLIENT_API_VERSION,
				entry: "client/index.tsx",
			});
			const documentOf = (artifact: typeof plain.artifact) =>
				text(artifact.files.find((file) => file.name === "index.html")?.contents);

			expect(documentOf(plain.artifact)).toContain("<title>Anime &amp; Manga</title>");
			expect(documentOf(other.artifact)).toContain("<title>Fitness</title>");
			expect(documentOf(plain.artifact)).toContain('<html lang="en">');
			expect(other.artifact.hash).not.toBe(plain.artifact.hash);
		}),
	30_000,
);

it.effect(
	"bundles a shared source imported from a client source through the neutral plugin kit surface",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* compileFixture({
				"client/index.tsx": bytes(
					'import { decodeRow } from "../shared/row";\nconsole.log(decodeRow({ id: "e", at: "2024-01-01T00:00:00.000Z" }));',
				),
				"shared/row.ts": bytes(
					[
						'import { Schema } from "@ryot-app/plugin-kit/effect";',
						'import { IsoDateString } from "@ryot-app/plugin-kit/ryotql";',
						'import { EntityId } from "@ryot-app/plugin-kit/schema";',
						"",
						"export const Row = Schema.Struct({ id: EntityId, at: IsoDateString });",
						"export const decodeRow = Schema.decodeUnknownSync(Row);",
					].join("\n"),
				),
			});

			const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
			expect(javascript).not.toContain("@ryot-app/plugin-kit");
			expect(javascript).toContain("EntityId");
			expect(javascript).toContain("DateTimeUtcFromString");
			expect(javascript).toContain("formatIso");
		}),
	60_000,
);

it.effect(
	"rejects a shared source that imports a client source",
	() =>
		Effect.gen(function* () {
			const failure = yield* compileFixture({
				"client/index.tsx": bytes('export { label } from "../shared/label";'),
				"client/theme.ts": bytes('export const theme = "dark";'),
				"shared/label.ts": bytes(
					'import { theme } from "../client/theme";\n\nexport const label = theme;',
				),
			}).pipe(Effect.flip);

			expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
			expect(failure.diagnostics[0]?.file).toBe("shared/label.ts");
			expect(failure.diagnostics[0]?.message).toContain("could not be resolved");
		}),
	30_000,
);

it.effect(
	"rejects a shared source that imports a client-only trusted module",
	() =>
		Effect.gen(function* () {
			const failure = yield* compileFixture({
				"client/index.tsx": bytes('export { Label } from "../shared/label";'),
				"shared/label.ts": bytes(
					'import { Button } from "@ryot-app/client-ui-sdk";\n\nexport const Label = Button;',
				),
			}).pipe(Effect.flip);

			expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
			expect(failure.diagnostics[0]?.file).toBe("shared/label.ts");
			expect(failure.diagnostics[0]?.message).toContain("@ryot-app/client-ui-sdk");
			expect(failure.diagnostics[0]?.message).toContain("plugin shared sources");
		}),
	30_000,
);

it.effect(
	"checks unreachable archived shared sources",
	() =>
		Effect.gen(function* () {
			const failure = yield* compileFixture({
				"client/index.tsx": bytes("export {};"),
				"shared/ignored.test.ts": bytes("const ignored: string = 1;"),
				"shared/unreachable.ts": bytes("const unreachable: string = 1;"),
			}).pipe(Effect.flip);

			expect(failure.diagnostics).toHaveLength(1);
			expect(failure.diagnostics[0]).toMatchObject({
				code: "TS2322",
				severity: "error",
				file: "shared/unreachable.ts",
			});
		}),
	30_000,
);

it.effect(
	"executes public exports from isolated contributors with their reachable CSS and assets",
	() =>
		Effect.gen(function* () {
			const mediaImage = new Uint8Array([1, 3, 5]);
			const fixtureImage = new Uint8Array([2, 4, 6]);
			const { artifact } = yield* compileGraph({
				contributorOrder: ["user", "media", "fixture"],
				contributors: {
					user: {
						files: {
							"client/page.tsx": bytes(`
import MediaCard from "@ryot-app/plugins/media/show-card";
import PokemonCard from "@ryot-app/plugins/fixture/pokemon-card";
export default function Page() { return <><MediaCard /><PokemonCard /></>; }
`),
						},
					},
					media: {
						files: {
							"client/card.tsx": bytes(`
import "./styles.css";
import image from "./image.png";
import React from "react";
Reflect.set(globalThis, "ryotTestReact", React);
Reflect.set(globalThis, "ryotTestContributors", ["media"]);
export default function Card() { return <img className="media-card" src={image} />; }
`),
							"client/styles.css": bytes(
								'.media-card { background: url("./image.png"); } .shared-priority { color: red; }',
							),
							"client/image.png": mediaImage,
							"client/unrelated.ts": bytes(
								"const invalid: string = 1;" +
									" ".repeat(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes),
							),
							"client/unrelated.css": bytes(".unrelated-page { color: red; }"),
						},
					},
					fixture: {
						files: {
							"client/card.tsx": bytes(`
import "./styles.css";
import image from "./image.png";
import React from "react";
if (Reflect.get(globalThis, "ryotTestReact") !== React) throw new Error("duplicate React");
(Reflect.get(globalThis, "ryotTestContributors") as string[]).push("fixture");
export default function Card() { return <img className="fixture-card" src={image} />; }
`),
							"client/styles.css": bytes(
								'.fixture-card { background: url("./image.png"); } .shared-priority { color: blue; }',
							),
							"client/image.png": fixtureImage,
						},
					},
				},
				publicExports: {
					"@ryot-app/plugins/media/show-card": {
						kind: "component",
						contributor: "media",
						entry: "client/card.tsx",
					},
					"@ryot-app/plugins/fixture/pokemon-card": {
						kind: "component",
						contributor: "fixture",
						entry: "client/card.tsx",
					},
				},
			});

			const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
			const css = text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
			// oxlint-disable-next-line typescript/no-implied-eval -- exercises the emitted composition
			Function("document", javascript)({ getElementById: () => null });
			expect(Reflect.get(globalThis, "ryotTestContributors")).toEqual(["media", "fixture"]);
			expect(artifact.files.filter(({ name }) => name.endsWith(".png"))).toHaveLength(2);
			expect(css).toContain(".media-card");
			expect(css).toContain(".fixture-card");
			expect(css).not.toContain(".unrelated-page");
			expect(css.match(/box-sizing: border-box/g)).toHaveLength(1);
			const priorityColors: string[] = [];
			parse(css).walkRules(".shared-priority", (rule) => {
				rule.walkDecls("color", ({ value }) => {
					priorityColors.push(value);
				});
			});
			expect(priorityColors).toEqual(["red", "blue"]);
			Reflect.deleteProperty(globalThis, "ryotTestContributors");
			Reflect.deleteProperty(globalThis, "ryotTestReact");
		}),
	60_000,
);

it.effect(
	"rejects unauthorized, private, traversing, cross-contributor, and backend public imports",
	() =>
		Effect.gen(function* () {
			for (const source of [
				'import Missing from "@ryot-app/plugins/media/missing"; export default Missing;',
				'import Private from "@ryot-app/plugins/media/private-card"; export default Private;',
				'import Traversal from "@ryot-app/plugins/media/../private"; export default Traversal;',
				'import Cross from "../../media/client/card"; export default Cross;',
			]) {
				const failure = yield* compileGraph({
					contributors: {
						user: { files: { "client/page.tsx": bytes(source) } },
						media: {
							files: {
								"client/card.tsx": bytes("export default function Card() { return null; }"),
							},
						},
					},
					publicExports: {
						"@ryot-app/plugins/media/card": {
							kind: "component",
							contributor: "media",
							entry: "client/card.tsx",
						},
					},
				}).pipe(Effect.flip);
				expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
			}

			const backend = yield* compileGraph({
				contributors: {
					media: { files: { "backend/private.tsx": bytes("export default null;") } },
					user: {
						files: { "client/page.tsx": bytes("export default function Page() { return null; }") },
					},
				},
				publicExports: {
					"@ryot-app/plugins/media/private": {
						kind: "component",
						contributor: "media",
						entry: "backend/private.tsx",
					},
				},
			}).pipe(Effect.flip);
			expect(backend.diagnostics[0]?.code).toBe("RYOT_CLIENT_SOURCE_PATH");

			const sharedPublic = yield* compileGraph({
				contributors: {
					user: {
						files: {
							"client/page.tsx": bytes(
								'import Value from "../shared/value"; export default Value;',
							),
							"shared/value.ts": bytes(
								'import Card from "@ryot-app/plugins/media/card"; export default Card;',
							),
						},
					},
					media: {
						files: {
							"client/card.tsx": bytes("export default function Card() { return null; }"),
						},
					},
				},
				publicExports: {
					"@ryot-app/plugins/media/card": {
						kind: "component",
						contributor: "media",
						entry: "client/card.tsx",
					},
				},
			}).pipe(Effect.flip);
			expect(sharedPublic.diagnostics[0]?.file).toBe("contributors/user/shared/value.ts");
			expect(sharedPublic.diagnostics[0]?.message).toContain("plugin shared sources");
		}),
	60_000,
);

it.effect("checks generated public export types and the aggregate reachable graph limit", () =>
	Effect.gen(function* () {
		const invalidType = yield* compileGraph({
			contributors: {
				user: {
					files: {
						"client/page.tsx": bytes(
							'import Other from "@ryot-app/plugins/media/other-page"; export default Other;',
						),
					},
				},
				media: {
					files: {
						"client/page.tsx": bytes(
							"export default function Page(_props: { required: string }) { return null; }",
						),
					},
				},
			},
			publicExports: {
				"@ryot-app/plugins/media/other-page": {
					kind: "page",
					contributor: "media",
					entry: "client/page.tsx",
				},
			},
		}).pipe(Effect.flip);
		expect(invalidType.diagnostics.some(({ code }) => code === "TS2322")).toBe(true);

		const half = Math.floor(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes / 2) + 1;
		const limit = yield* compileGraph({
			contributors: {
				user: {
					files: {
						"client/page.tsx": bytes(
							'import { first } from "./first"; import Second from "@ryot-app/plugins/media/second"; console.log(first, Second); export default function Page() { return null; }',
						),
						"client/first.ts": bytes(`export const first = 1;${" ".repeat(half)}`),
					},
				},
				media: {
					files: {
						"client/second.tsx": bytes(
							`export default function Second() { return null; }${" ".repeat(half)}`,
						),
					},
				},
			},
			publicExports: {
				"@ryot-app/plugins/media/second": {
					kind: "component",
					contributor: "media",
					entry: "client/second.tsx",
				},
			},
		}).pipe(Effect.flip);
		expect(limit.diagnostics[0]?.code).toBe("RYOT_CLIENT_SOURCE_SIZE");
	}),
);

it.effect("keeps cyclic contributor graphs stable and validates automatic registry entries", () =>
	Effect.gen(function* () {
		const input = {
			contributors: {
				user: {
					files: {
						"client/page.tsx": bytes(
							'import Media from "@ryot-app/plugins/media/card"; export default Media;',
						),
					},
				},
				media: {
					files: {
						"client/card.tsx": bytes(
							'import "@ryot-app/plugins/fixture/presentation"; export default function Card() { return null; }',
						),
					},
				},
				fixture: {
					files: {
						"client/presentation.tsx": bytes(
							'import "@ryot-app/plugins/media/card"; import { defineEntityPresentation } from "@ryot-app/client-sdk/plugin"; export default defineEntityPresentation({ loader: async ({ references }) => Object.fromEntries(references.map(({ entityId }) => [entityId, { label: entityId }])), component: ({ data }) => <p>{data.label}</p> });',
						),
					},
				},
			},
			publicExports: {
				"@ryot-app/plugins/media/card": {
					contributor: "media",
					entry: "client/card.tsx",
					kind: "component" as const,
				},
				"@ryot-app/plugins/fixture/presentation": {
					contributor: "fixture",
					kind: "presentation" as const,
					entry: "client/presentation.tsx",
				},
			},
			automaticRegistry: [
				{
					layout: "list" as const,
					ownerPluginId: "a-owner",
					entitySchemaSlug: "album",
					exportSpecifier: "@ryot-app/plugins/fixture/presentation",
				},
				{
					layout: "grid" as const,
					ownerPluginId: "fixture-id",
					entitySchemaSlug: "pokemon",
					exportSpecifier: "@ryot-app/plugins/fixture/presentation",
				},
			],
		};
		const first = yield* compileGraph(input);
		const second = yield* compileGraph({
			...input,
			contributors: Object.fromEntries(Object.entries(input.contributors).toReversed()),
			publicExports: Object.fromEntries(Object.entries(input.publicExports).toReversed()),
		});
		expect(second.artifact).toEqual(first.artifact);
		const javascript = text(
			first.artifact.files.find(({ name }) => name === "plugin.js")?.contents,
		);
		expect(javascript).toContain("entityPresentations");
		expect(javascript).toContain("fixture-id");
		expect(javascript).toContain("pokemon");
		expect(javascript.indexOf("a-owner")).toBeLessThan(javascript.indexOf("fixture-id"));
	}),
);

it.effect("rejects plugin-kit imports from client sources while preserving shared imports", () =>
	Effect.gen(function* () {
		const failure = yield* compileFixture({
			"client/index.tsx": bytes(
				'import { Schema } from "@ryot-app/plugin-kit/effect"; console.log(Schema);',
			),
		}).pipe(Effect.flip);
		expect(failure.diagnostics[0]?.code).toBe("RYOT_CLIENT_IMPORT");
		expect(failure.diagnostics[0]?.file).toBe("client/index.tsx");
	}),
);

it("executes a generated plugin registry with dynamic params and not-found", async () => {
	const { artifact } = await Effect.runPromise(
		compileClientPlugin({
			name: "Fixture routes",
			application: "plugin-route",
			contributorOrder: ["fixture"],
			apiVersion: CLIENT_API_VERSION,
			entry: { contributor: "fixture", path: "client/home.tsx" },
			contributors: {
				fixture: {
					files: {
						"client/home.tsx": bytes("export default function Home() { return <p>Home</p>; }"),
						"client/details.tsx": bytes(`
import { usePluginParams } from "@ryot-app/client-sdk/plugin";
export default function Details() {
  const { itemId } = usePluginParams();
  return <p>Details:{itemId}</p>;
}
`),
						"client/new-item.tsx": bytes(
							"export default function NewItem() { return <p>New item</p>; }",
						),
						"client/not-found.tsx": bytes(
							"export default function NotFound() { return <p>Fixture not found</p>; }",
						),
					},
				},
			},
			publicExports: {
				"@ryot-app/plugins/fixture/home": {
					kind: "page",
					contributor: "fixture",
					entry: "client/home.tsx",
				},
				"@ryot-app/plugins/fixture/details": {
					kind: "page",
					contributor: "fixture",
					entry: "client/details.tsx",
				},
				"@ryot-app/plugins/fixture/not-found": {
					kind: "page",
					contributor: "fixture",
					entry: "client/not-found.tsx",
				},
				"@ryot-app/plugins/fixture/new-item": {
					kind: "page",
					contributor: "fixture",
					entry: "client/new-item.tsx",
				},
			},
			routeRegistry: {
				home: "@ryot-app/plugins/fixture/home",
				notFound: "@ryot-app/plugins/fixture/not-found",
				routes: [
					{ path: "/items/$itemId", exportSpecifier: "@ryot-app/plugins/fixture/details" },
					{ path: "/items/new", exportSpecifier: "@ryot-app/plugins/fixture/new-item" },
				],
			},
		}).pipe(Effect.mapError((error) => new Error(JSON.stringify(error.diagnostics)))),
	);
	const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
		url: "https://fixture.test",
	});
	const { document } = dom.window;
	const window = dom.window;
	let initialize: EventListener | undefined;
	const addEventListener = window.addEventListener.bind(window);
	window.addEventListener = ((
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === "message" && initialize === undefined) {
			initialize =
				typeof listener === "function" ? listener : (event) => listener.handleEvent(event);
			return;
		}
		addEventListener(type, listener, options);
	}) as typeof window.addEventListener;
	document.body.innerHTML = '<div id="app"></div>';
	const metadata = document.createElement("script");
	metadata.id = CLIENT_ARTIFACT_METADATA_ELEMENT_ID;
	metadata.type = "application/json";
	metadata.textContent = JSON.stringify({
		hash: artifact.hash,
		format: artifact.format,
		apiVersion: artifact.apiVersion,
		bridgeVersion: artifact.bridgeVersion,
		compilerVersion: artifact.compilerVersion,
	});
	document.head.append(metadata);
	const javascript = new TextDecoder().decode(
		artifact.files.find(({ name }) => name === "plugin.js")?.contents,
	);
	// oxlint-disable-next-line typescript/no-implied-eval -- executes the emitted application
	Function(
		"window",
		"document",
		"AbortController",
		javascript,
	)(window, document, window.AbortController);
	const channel = new MessageChannel();
	const ready = new Promise<void>((resolve) => {
		channel.port1.addEventListener("message", (event) => {
			if (event.data?.artifactHash === artifact.hash) {
				resolve();
			}
		});
	});
	channel.port1.start();
	const pluginPort = {
		start: () => channel.port2.start(),
		close: () => channel.port2.close(),
		postMessage: (message: unknown) => channel.port2.postMessage(message),
		addEventListener: (
			type: "message",
			listener: EventListener,
			options?: AddEventListenerOptions,
		) => {
			channel.port2.addEventListener(type, listener);
			options?.signal?.addEventListener("abort", () =>
				channel.port2.removeEventListener(type, listener),
			);
		},
	};
	expect(initialize).toBeDefined();
	const initEvent = new window.Event("message");
	Object.defineProperties(initEvent, {
		ports: { value: [pluginPort] },
		source: { value: window.parent },
		data: {
			value: {
				mode: "light",
				safeAreaTop: 0,
				safeAreaBottom: 0,
				sessionId: "session-1",
				format: artifact.format,
				artifactHash: artifact.hash,
				apiVersion: artifact.apiVersion,
				bridgeVersion: artifact.bridgeVersion,
				compilerVersion: artifact.compilerVersion,
			},
		},
	});
	initialize?.(initEvent);
	await ready;
	channel.port1.postMessage({
		index: 0,
		key: "details",
		compact: false,
		edgeBack: false,
		type: "location",
		leading: "drawer",
		location: { kind: "route", path: "/items/new", search: "" },
	});
	await waitFor(() => expect(document.getElementById("app")?.textContent).toBe("New item"), {
		container: document.body,
	});
	channel.port1.postMessage({
		index: 1,
		key: "missing",
		compact: false,
		edgeBack: true,
		type: "location",
		leading: "back",
		location: { kind: "route", path: "/missing", search: "" },
	});
	await waitFor(
		() => expect(document.getElementById("app")?.textContent).toContain("Fixture not found"),
		{ container: document.body },
	);
	channel.port1.close();
	channel.port2.close();
	dom.window.close();
});
