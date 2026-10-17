import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { resolveClientPluginCompilerDependencies } from "./dependencies";
import { analyzeClientPluginTypes } from "./semantic-check";
import { validateClientSourcePolicy } from "./styles";

const encoder = new TextEncoder();

const diagnose = Effect.fnUntraced(function* (sourceFiles: Readonly<Record<string, string>>) {
	const dependencies = yield* resolveClientPluginCompilerDependencies;
	const textSources = Object.fromEntries(
		Object.entries(sourceFiles).filter(([path]) => /\.(?:tsx?|css)$/.test(path)),
	);
	const analysis = yield* analyzeClientPluginTypes(textSources, dependencies);
	return validateClientSourcePolicy({
		sourceFiles: textSources,
		parsedFiles: analysis.sourceFiles,
		files: Object.fromEntries([
			...Object.entries(sourceFiles).map(([path, contents]) => [path, encoder.encode(contents)]),
			["x.css", encoder.encode("")],
			["client/x.css", encoder.encode("")],
			["shared/x.ts", encoder.encode("")],
		]),
	}).map(({ code, file }) => [code, file]);
});

it.effect("keeps relative script imports inside their client or shared source root", () =>
	Effect.gen(function* () {
		for (const [importer, specifier] of [
			["shared/a.ts", "../client/b"],
			["shared/a.ts", "./../client/b"],
			["client/a.ts", "../../x"],
			["client/a.ts", "..//../x"],
			["client/nested/a.ts", "..//..//../x"],
			["shared/a.ts", "..//x"],
		] as const) {
			expect([specifier, yield* diagnose({ [importer]: `import "${specifier}";` })]).toEqual([
				specifier,
				[["RYOT_CLIENT_IMPORT", importer]],
			]);
		}
		expect(
			yield* diagnose({
				"shared/y.ts": 'import "./x";',
				"client/nested/c.ts": 'import "..//b";',
				"client/a.ts": 'import "../shared/x"; import "./b";',
			}),
		).toEqual([]);
	}),
);

it.effect("keeps stylesheet imports inside the client source root", () =>
	Effect.gen(function* () {
		for (const [importer, specifier] of [
			["client/styles.css", "../../x.css"],
			["client/styles.css", "../x.css"],
			["client/nested/styles.css", "..//..//x.css"],
			["client/styles.css", "./..//x.css"],
		] as const) {
			expect([specifier, yield* diagnose({ [importer]: `@import "${specifier}";` })]).toEqual([
				specifier,
				[["RYOT_CLIENT_STYLES", importer]],
			]);
		}
		expect(yield* diagnose({ "client/nested/styles.css": '@import "..//x.css";' })).toEqual([]);
	}),
);

it.effect.each(["client/shared", "client/client", "shared/client", "shared/shared"])(
	"uses the top-level source region for imports and assets under %s",
	(directory) =>
		Effect.gen(function* () {
			const shared = directory.startsWith("shared/");
			const script = `${directory}/card.tsx`;
			const stylesheet = `${directory}/styles.css`;
			const region = shared ? "shared" : "client";
			expect(yield* diagnose({ [script]: 'import "../value";' })).toEqual([]);
			expect(yield* diagnose({ [script]: 'import "../../shared/value";' })).toEqual(
				shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
			);
			expect(yield* diagnose({ [script]: 'import "react";' })).toEqual(
				shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
			);
			expect(yield* diagnose({ [script]: 'import "@ryot-app/plugin-kit/effect";' })).toEqual(
				shared ? [] : [["RYOT_CLIENT_IMPORT", script]],
			);
			expect(yield* diagnose({ [script]: 'import "../../client/value";' })).toEqual(
				shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
			);
			expect(yield* diagnose({ [script]: 'import "../../../client/value";' })).toEqual([
				["RYOT_CLIENT_IMPORT", script],
			]);
			expect(
				yield* diagnose({ [`${region}/x.css`]: "", [stylesheet]: '@import "../x.css";' }),
			).toEqual([]);
			expect(yield* diagnose({ [stylesheet]: '@import "../../../x.css";' })).toEqual([
				["RYOT_CLIENT_STYLES", stylesheet],
			]);
			for (const path of [script, stylesheet]) {
				const asset = (url: string) =>
					path === script
						? `export const image = new URL("${url}", import.meta.url);`
						: `.image { background: url("${url}"); }`;
				const files = { [`${region}/image.svg`]: "<svg/>" };
				expect(yield* diagnose({ ...files, [path]: asset("../image.svg") })).toEqual([]);
				expect(
					yield* diagnose({ ...files, [path]: asset(`../../../${region}/image.svg`) }),
				).toEqual([[path === script ? "RYOT_CLIENT_IMPORT" : "RYOT_CLIENT_STYLES", path]]);
			}
		}),
);
