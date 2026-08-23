import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

import { expect, it } from "@effect/vitest";
import { CLIENT_API_VERSION } from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

import { compileClientPlugin, type ClientPluginCompilerGraphInput } from "./compile";
import { CLIENT_PLUGIN_COMPILER_LIMITS } from "./limits";
import {
	createStylexTracerBundleAdapter,
	deriveStylexTracerBuildFingerprint,
	STYLEX_TRACER_BUILD_FINGERPRINT,
} from "./stylex-tracer";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const bytes = (value: string) => encoder.encode(value);
const text = (value: Uint8Array | undefined) => decoder.decode(value);
const atomicStyleSource = (color: string) => `import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ root: { color: "${color}" } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`;
const cssOf = (artifact: {
	readonly files: readonly { readonly name: string; readonly contents: Uint8Array }[];
}) => text(artifact.files.find(({ name }) => name === "plugin.css")?.contents);
const importColumn = (line: string) => line.indexOf('"') + 1;

const tracerPackage = (
	source: string,
	files: Readonly<Record<string, Uint8Array>> = {},
	fingerprint = "test-fingerprint",
) =>
	compileClientPlugin({
		name: "StyleX tracer",
		stylexTracer: { fingerprint },
		apiVersion: CLIENT_API_VERSION,
		files: { ...files, "client/view.tsx": bytes(source) },
		publicExports: { tracer: { kind: "component", entry: "client/view.tsx" } },
	});

const tracerGraph = (source: string, overrides: Partial<ClientPluginCompilerGraphInput> = {}) =>
	compileClientPlugin({
		publicExports: {},
		application: "page",
		name: "StyleX tracer page",
		contributorOrder: ["tracer"],
		apiVersion: CLIENT_API_VERSION,
		stylexTracer: { fingerprint: "graph-fingerprint" },
		entry: { contributor: "tracer", path: "client/page.tsx" },
		contributors: { tracer: { files: { "client/page.tsx": bytes(source) } } },
		...overrides,
	});

it.effect(
	"extracts shared and archive-local tokens without Tailwind, theme, or palette CSS",
	() =>
		Effect.gen(function* () {
			const { artifact } = yield* tracerPackage(
				`import * as stylex from "@stylexjs/stylex";
import { StyleXTracerPanel } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { tracerTokens } from "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
import { localTokens } from "./tokens.stylex";
const styles = stylex.create({
  root: { color: tracerTokens.foreground, maxWidth: "calc(100% - 48px)", outlineColor: localTokens.ring } satisfies stylex.CSSProperties,
  hover: { ":hover": { color: tracerTokens.accent } satisfies stylex.CSSProperties },
  reducedMotion: { "@media (prefers-reduced-motion: reduce)": { transitionDuration: "0ms" } satisfies stylex.CSSProperties },
  dynamic: (width: number): stylex.CSSProperties => ({ width }),
});
export default function View() {
  return <div {...stylex.props(styles.root, styles.hover, styles.reducedMotion, styles.dynamic(37))}>
    <StyleXTracerPanel compact={false} portalRoot={null} resolvedTheme="light" safeAreaBottom={0} safeAreaTop={0} />
  </div>;
}`,
				{
					"client/tokens.stylex.ts": bytes(`import * as stylex from "@stylexjs/stylex";
export const localTokens = stylex.defineVars({ ring: "#13579b" });`),
				},
			);
			const css = cssOf(artifact);
			const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);

			expect(css).toContain("#13579b");
			expect(css).toContain("#25221d");
			expect(css).toContain("font-family: 'Outfit Variable'");
			expect(css).toContain(`ryot-stylex-tracer:${STYLEX_TRACER_BUILD_FINGERPRINT}`);
			expect(css).not.toContain("--bg:");
			expect(css).not.toContain("--accent:");
			expect(css).not.toContain("prefers-color-scheme");
			expect(css).not.toContain("tailwindcss");
			expect(css).toContain("calc(100% - 48px)");
			expect(css).toContain(":hover");
			expect(css).toContain("prefers-reduced-motion");
			expect(css).toContain("width:var(");
			expect(javascript).not.toContain("stylex-inject");
		}),
	60_000,
);

it.effect(
	"uses the normal generated page bootstrap and artifact asset model",
	() =>
		Effect.gen(function* () {
			const image = new Uint8Array([1, 4, 9]);
			const source = `import * as stylex from "@stylexjs/stylex";
import { StyleXTracerButton } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { tracerTokens } from "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
import { OverlayScope } from "@ryot-app/client-ui-sdk/shortcut";
import image from "./mark.png";

Reflect.set(globalThis, "stylexTracerPageExecutions", Number(Reflect.get(globalThis, "stylexTracerPageExecutions") ?? 0) + 1);
const styles = stylex.create({ root: { color: tracerTokens.foreground, backgroundColor: tracerTokens.surface } satisfies stylex.CSSProperties });
export default function Page() {
  return <OverlayScope onEscape={() => {}}><StyleXTracerButton xstyle={styles.root}><img alt="" src={image} />Shared control</StyleXTracerButton></OverlayScope>;
}`;
			const { artifact } = yield* tracerGraph(source, {
				contributors: {
					tracer: { files: { "client/mark.png": image, "client/page.tsx": bytes(source) } },
				},
			});
			const javascript = text(artifact.files.find(({ name }) => name === "plugin.js")?.contents);
			expect(javascript).toContain("createRoot");
			// oxlint-disable-next-line typescript/no-implied-eval -- executes the generated page bootstrap
			Function("document", javascript)({ getElementById: () => null });
			expect(Reflect.get(globalThis, "stylexTracerPageExecutions")).toBe(1);
			Reflect.deleteProperty(globalThis, "stylexTracerPageExecutions");
			expect(artifact.files.some(({ name }) => name.endsWith(".png"))).toBe(true);
			expect(artifact.files.at(-1)?.name).toBe("index.html");
		}),
	30_000,
);

it.effect(
	"isolates tracer mode and folds both fingerprints into deterministic bytes",
	() =>
		Effect.gen(function* () {
			const source = `import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ root: { color: "#102938" } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`;
			const first = yield* tracerPackage(source, {}, "fingerprint-a");
			const repeated = yield* tracerPackage(source, {}, "fingerprint-a");
			const changed = yield* tracerPackage(source, {}, "fingerprint-b");
			const ordinaryFailure = yield* compileClientPlugin({
				name: "Ordinary",
				apiVersion: CLIENT_API_VERSION,
				files: { "client/view.tsx": bytes(source) },
				publicExports: { tracer: { kind: "component", entry: "client/view.tsx" } },
			}).pipe(Effect.flip);

			expect(repeated.artifact).toEqual(first.artifact);
			expect(changed.artifact.hash).not.toBe(first.artifact.hash);
			expect(cssOf(changed.artifact)).not.toContain("fingerprint-b");
			expect(ordinaryFailure.diagnostics[0]).toMatchObject({ code: "RYOT_CLIENT_IMPORT" });

			const ordinaryOverlayFailure = yield* compileClientPlugin({
				name: "Ordinary overlay",
				apiVersion: CLIENT_API_VERSION,
				publicExports: { tracer: { kind: "component", entry: "client/view.tsx" } },
				files: {
					"client/view.tsx": bytes(
						'import { useFocusTrap } from "@ryot-app/client-ui-sdk/overlay"; export default useFocusTrap;',
					),
				},
			}).pipe(Effect.flip);
			expect(ordinaryOverlayFailure.diagnostics[0]?.message).toContain(
				"@ryot-app/client-ui-sdk/overlay",
			);
		}),
	30_000,
);

it("changes the derived build fingerprint when implementation or Bun identity changes", () => {
	const stableInputs = [
		["@ryot-app/client-plugin-compiler/src/stylex-tracer.ts", "implementation-hash"],
		["runtime/bun", "bun-identity-hash"],
	] as const;
	const changedImplementationInputs = [
		["@ryot-app/client-plugin-compiler/src/stylex-tracer.ts", "changed-implementation-hash"],
		stableInputs[1],
	] as const;
	const changedBunInputs = [stableInputs[0], ["runtime/bun", "changed-bun-identity-hash"]] as const;

	expect(deriveStylexTracerBuildFingerprint(stableInputs)).not.toBe(
		deriveStylexTracerBuildFingerprint(changedImplementationInputs),
	);
	expect(deriveStylexTracerBuildFingerprint(stableInputs)).not.toBe(
		deriveStylexTracerBuildFingerprint(changedBunInputs),
	);
});

it("requires a restart before changed trusted sources can produce artifact bytes", () => {
	const compilerRoot = dirname(Bun.fileURLToPath(import.meta.url));
	const adapter = createStylexTracerBundleAdapter({}, compilerRoot, (path) => {
		const source = readFileSync(path, "utf8");
		return path.endsWith("/stylex-tracer/tokens.stylex.ts")
			? source.replace('border: "#d6d0c4"', 'border: "#123456"')
			: source;
	});
	try {
		expect(adapter.preflightDiagnostics).toEqual([
			expect.objectContaining({
				code: "RYOT_CLIENT_STYLEX_RESTART_REQUIRED",
				file: "trusted/stylex-tracer/tokens.stylex.ts",
			}),
		]);
	} finally {
		adapter.cleanup();
	}
});

it.effect("rejects every original import form before StyleX can erase it", () =>
	Effect.gen(function* () {
		const source = `// @ts-ignore -- must not bypass the archive import policy
import type { Hidden } from "unapproved-type-package";
export type { HiddenExport } from "unapproved-export-package";
import "unapproved-side-effect-package";
void import("unapproved-dynamic-package");
export default function View() { return null; }`;
		const failure = yield* tracerPackage(source).pipe(Effect.flip);
		const lines = source.split("\n");

		expect(failure.diagnostics).toHaveLength(4);
		for (const [index, diagnostic] of failure.diagnostics.entries()) {
			const line = index + 2;
			expect(diagnostic).toMatchObject({
				line,
				file: "client/view.tsx",
				code: "RYOT_CLIENT_IMPORT",
				column: importColumn(lines[line - 1] ?? ""),
			});
			expect(diagnostic.message).toContain("unapproved-");
		}
	}),
);

it.effect("enforces tracer graph limits before the virtual source build", () =>
	Effect.gen(function* () {
		const half = Math.floor(CLIENT_PLUGIN_COMPILER_LIMITS.sourceBytes / 2) + 1;
		const sourceFailure = yield* tracerGraph("export default function Page() { return null; }", {
			contributorOrder: ["first", "second"],
			entry: { contributor: "first", path: "client/page.tsx" },
			contributors: {
				second: { files: { "client/unreachable.ts": bytes(`export {};${" ".repeat(half)}`) } },
				first: {
					files: {
						"client/page.tsx": bytes(
							`export default function Page() { return null; }${" ".repeat(half)}`,
						),
					},
				},
			},
		}).pipe(Effect.flip);
		expect(sourceFailure.diagnostics[0]?.code).toBe("RYOT_CLIENT_SOURCE_SIZE");

		const assetFailure = yield* tracerGraph("export default function Page() { return null; }", {
			contributors: {
				tracer: {
					files: {
						"client/page.tsx": bytes("export default function Page() { return null; }"),
						"client/unreachable.png": new Uint8Array(CLIENT_PLUGIN_COMPILER_LIMITS.assetBytes + 1),
					},
				},
			},
		}).pipe(Effect.flip);
		expect(assetFailure.diagnostics[0]).toMatchObject({
			code: "RYOT_CLIENT_ASSET_SIZE",
			file: "contributors/tracer/client/unreachable.png",
		});
	}),
);

it.effect(
	"keeps concurrent rules and failed-build rules local to one compilation",
	() =>
		Effect.gen(function* () {
			const [first, second] = yield* Effect.all(
				[tracerPackage(atomicStyleSource("#010203")), tracerPackage(atomicStyleSource("#a1b2c3"))],
				{ concurrency: "unbounded" },
			);
			expect(cssOf(first.artifact)).toContain("#010203");
			expect(cssOf(first.artifact)).not.toContain("#a1b2c3");
			expect(cssOf(second.artifact)).toContain("#a1b2c3");
			expect(cssOf(second.artifact)).not.toContain("#010203");

			const temporaryDirectoriesBefore = new Set(
				new Bun.Glob("ryot-stylex-tracer-*").scanSync({ cwd: tmpdir(), onlyFiles: false }),
			);
			const failed = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ root: { color: globalThis.notAStyleToken } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`).pipe(
				Effect.flip,
			);
			expect(failed.diagnostics[0]).toMatchObject({ code: "RYOT_CLIENT_STYLEX" });
			expect(failed.diagnostics[0]?.line).toBe(2);
			expect(failed.diagnostics[0]?.column).toBeGreaterThan(1);
			expect(
				new Set(new Bun.Glob("ryot-stylex-tracer-*").scanSync({ cwd: tmpdir(), onlyFiles: false })),
			).toEqual(temporaryDirectoriesBefore);

			const afterFailure = yield* tracerPackage(atomicStyleSource("#fedcba"));
			expect(cssOf(afterFailure.artifact)).toContain("#fedcba");
			expect(cssOf(afterFailure.artifact)).not.toContain("notAStyleToken");
		}),
	30_000,
);

it.effect("reports bounded StyleX and import-policy failures against logical author sources", () =>
	Effect.gen(function* () {
		const cases = [
			{
				code: "RYOT_CLIENT_STYLEX",
				message: "border is not supported",
				source: `import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ root: { border: "invalid" } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`,
			},
			{
				code: "RYOT_CLIENT_IMPORT",
				message: "unapproved-package",
				source: `import value from "unapproved-package";
export default function View() { return <div>{value}</div>; }`,
			},
			{
				code: "RYOT_CLIENT_IMPORT",
				message: "could not be resolved",
				source: `import { token } from "../outside/tokens.stylex";
export default function View() { return <div>{token}</div>; }`,
			},
		] as const;
		for (const fixture of cases) {
			const failure = yield* tracerPackage(fixture.source).pipe(Effect.flip);
			expect(failure.diagnostics[0]).toMatchObject({ code: fixture.code, file: "client/view.tsx" });
			expect(failure.diagnostics[0]?.message).toContain(fixture.message);
			expect(failure.diagnostics[0]?.line).toBeGreaterThan(0);
			expect(failure.diagnostics[0]?.column).toBeGreaterThan(0);
		}

		for (const specifier of ["./missing-tokens.stylex", "../outside/tokens.stylex"]) {
			const source = `import * as stylex from "@stylexjs/stylex";
import { token } from "${specifier}";
const styles = stylex.create({ root: { color: token } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`;
			const failure = yield* tracerPackage(source).pipe(Effect.flip);
			expect(failure.diagnostics[0]).toMatchObject({
				line: 2,
				file: "client/view.tsx",
				code: "RYOT_CLIENT_IMPORT",
				column: importColumn(source.split("\n")[1] ?? ""),
			});
			expect(failure.diagnostics[0]?.message).toContain(specifier);
		}
	}),
);

it.effect("requires the checked convention before accepting ordinary StyleX declarations", () =>
	Effect.gen(function* () {
		for (const declaration of [
			'{ colour: "#123456" }',
			'{ position: "absolut" }',
			'{ ":hover": { color: "red" } }',
			"(width: string) => ({ width })",
		]) {
			const failure = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({ root: ${declaration} });
export default function View() { return <div {...stylex.props(styles.root)} />; }`).pipe(
				Effect.flip,
			);
			expect(failure.diagnostics[0]).toMatchObject({
				line: 2,
				column: 38,
				file: "client/view.tsx",
				code: "RYOT_CLIENT_STYLEX_CONVENTION",
			});
		}

		const unreachableFailure = yield* tracerPackage(atomicStyleSource("#123456"), {
			"client/unreachable.ts": bytes(`import * as stylex from "@stylexjs/stylex";
stylex.create({ root: { color: "red" } });`),
		}).pipe(Effect.flip);
		expect(unreachableFailure.diagnostics[0]).toMatchObject({
			line: 2,
			file: "client/unreachable.ts",
			code: "RYOT_CLIENT_STYLEX_CONVENTION",
		});
	}),
);

it.effect("rejects every noncanonical StyleX create access at the archive boundary", () =>
	Effect.gen(function* () {
		const namespaceImport = 'import * as stylex from "@stylexjs/stylex";';
		const component = "export default function View() { return null; }";
		const cases = [
			{
				line: 2,
				column: 16,
				source: `${namespaceImport}\nconst styles = stylex["create"]({ root: { color: "red" } satisfies stylex.CSSProperties });\n${component}`,
			},
			{
				line: 2,
				column: 16,
				source: `${namespaceImport}\nconst create = stylex.create;\n${component}`,
			},
			{
				line: 2,
				column: 19,
				source: `${namespaceImport}\nconst forwarded = stylex;\n${component}`,
			},
			{
				line: 2,
				column: 20,
				source: `${namespaceImport}\nconst { create } = stylex;\n${component}`,
			},
			{
				line: 2,
				column: 27,
				source: `${namespaceImport}\nlet create; ({ create } = stylex);\n${component}`,
			},
			{
				line: 2,
				column: 22,
				source: `${namespaceImport}\nlet create; create = stylex.create;\n${component}`,
			},
			{ line: 2, column: 10, source: `${namespaceImport}\nexport { stylex };\n${component}` },
			{
				line: 2,
				column: 22,
				source: `${namespaceImport}\ntype Create = typeof stylex.create;\n${component}`,
			},
			{
				line: 2,
				column: 1,
				source: `${namespaceImport}\nstylex?.create({ root: { color: "red" } satisfies stylex.CSSProperties });\n${component}`,
			},
			{
				line: 2,
				column: 1,
				source: `${namespaceImport}\nstylex.create?.({ root: { color: "red" } satisfies stylex.CSSProperties });\n${component}`,
			},
			{ line: 1, column: 10, source: `import { create } from "@stylexjs/stylex";\n${component}` },
			{ line: 1, column: 8, source: `import stylex from "@stylexjs/stylex";\n${component}` },
			{ line: 1, column: 1, source: `import "@stylexjs/stylex";\n${component}` },
			{ line: 1, column: 24, source: `export { create } from "@stylexjs/stylex";\n${component}` },
			{ line: 1, column: 15, source: `export * from "@stylexjs/stylex";\n${component}` },
			{
				line: 2,
				column: 6,
				source: `${namespaceImport}\nvoid import("@stylexjs/stylex");\n${component}`,
			},
			{ line: 1, column: 1, source: `import stylex = require("@stylexjs/stylex");\n${component}` },
			{
				line: 2,
				column: 34,
				source: `${namespaceImport}\nconst input = {}; const styles = stylex.create(input);\n${component}`,
			},
			{
				line: 2,
				column: 16,
				source: `${namespaceImport}\nconst styles = stylex.create();\n${component}`,
			},
			{
				line: 2,
				column: 16,
				source: `${namespaceImport}\nconst styles = stylex.create({}, {});\n${component}`,
			},
		] as const;

		for (const fixture of cases) {
			const failure = yield* tracerPackage(fixture.source).pipe(Effect.flip);
			expect(failure.diagnostics[0]).toMatchObject({
				line: fixture.line,
				column: fixture.column,
				file: "client/view.tsx",
				code: "RYOT_CLIENT_STYLEX_CONVENTION",
			});
		}
	}),
);

it.effect(
	"reports checked CSS typo and constrained-value diagnostics with valid near-neighbors",
	() =>
		Effect.gen(function* () {
			const typo = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({
  valid: { color: "#123456" } satisfies stylex.CSSProperties,
  misspelled: { colour: "#123456" } satisfies stylex.CSSProperties,
});
export default function View() { return <div {...stylex.props(styles.valid)} />; }`).pipe(
				Effect.flip,
			);
			expect(typo.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ line: 4, code: "TS2561", file: "client/view.tsx" }),
				]),
			);

			const invalidValue = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({
  valid: { position: "absolute" } satisfies stylex.CSSProperties,
  invalid: { position: "absolut" } satisfies stylex.CSSProperties,
});
export default function View() { return <div {...stylex.props(styles.valid)} />; }`).pipe(
				Effect.flip,
			);
			expect(invalidValue.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ line: 4, code: "TS2820", file: "client/view.tsx" }),
				]),
			);

			const stylexValidation = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
const styles = stylex.create({
  valid: { borderColor: "red", borderStyle: "solid", borderWidth: 1 } satisfies stylex.CSSProperties,
  invalid: { border: "1px solid red" } satisfies stylex.CSSProperties,
});
export default function View() { return <div {...stylex.props(styles.valid, styles.invalid)} />; }`).pipe(
				Effect.flip,
			);
			expect(stylexValidation.diagnostics[0]).toMatchObject({
				file: "client/view.tsx",
				code: "RYOT_CLIENT_STYLEX",
			});
			expect(stylexValidation.diagnostics[0]?.message).toContain("border is not supported");
		}),
);

it.effect(
	"rejects forbidden control overrides and archived Babel configuration",
	() =>
		Effect.gen(function* () {
			const missingSharedToken = yield* tracerPackage(
				`import * as stylex from "@stylexjs/stylex";
import { tracerTokens } from "@ryot-app/client-ui-sdk/stylex-tracer/tokens.stylex";
const styles = stylex.create({ root: { color: tracerTokens.missing } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`,
			).pipe(Effect.flip);
			expect(missingSharedToken.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ line: 3, code: "TS2339", file: "client/view.tsx" }),
				]),
			);

			const missingToken = yield* tracerPackage(
				`import * as stylex from "@stylexjs/stylex";
import { localTokens } from "./tokens.stylex";
const styles = stylex.create({ root: { color: localTokens.missing } satisfies stylex.CSSProperties });
export default function View() { return <div {...stylex.props(styles.root)} />; }`,
				{
					"client/tokens.stylex.ts": bytes(`import * as stylex from "@stylexjs/stylex";
export const localTokens = stylex.defineVars({ present: "#123456" });`),
				},
			).pipe(Effect.flip);
			expect(missingToken.diagnostics[0]).toMatchObject({
				line: 3,
				code: "TS2339",
				file: "client/view.tsx",
			});
			expect(missingToken.diagnostics[0]?.message).toContain("missing");

			const forbidden = yield* tracerPackage(`import * as stylex from "@stylexjs/stylex";
import { StyleXTracerButton } from "@ryot-app/client-ui-sdk/stylex-tracer";
const overrides = stylex.create({ forbidden: { position: "absolute" } satisfies stylex.CSSProperties });
export default function View() { return <StyleXTracerButton xstyle={overrides.forbidden}>No</StyleXTracerButton>; }`).pipe(
				Effect.flip,
			);
			expect(forbidden.diagnostics.some(({ code }) => code.startsWith("TS"))).toBe(true);
			expect(forbidden.diagnostics.some(({ file }) => file === "client/view.tsx")).toBe(true);

			const config = yield* tracerPackage("export default function View() { return null; }", {
				"client/babel.config.ts": bytes('throw new Error("must not execute");'),
			}).pipe(Effect.flip);
			expect(config.diagnostics[0]).toMatchObject({
				file: "client/babel.config.ts",
				code: "RYOT_CLIENT_STYLEX_CONFIG",
			});

			const sharedStylex = yield* tracerPackage(
				'import { shared } from "../shared/value"; export default function View() { return <div>{shared}</div>; }',
				{
					"shared/value.ts": bytes(
						'import { useFocusTrap } from "@ryot-app/client-ui-sdk/overlay"; export const shared = useFocusTrap;',
					),
				},
			).pipe(Effect.flip);
			expect(sharedStylex.diagnostics[0]).toMatchObject({
				file: "shared/value.ts",
				code: "RYOT_CLIENT_IMPORT",
			});
		}),
	30_000,
);
