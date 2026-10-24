import { expect, it } from "vitest";

import { validateClientSourcePolicy } from "./styles";

const encoder = new TextEncoder();

const diagnose = (sourceFiles: Readonly<Record<string, string>>) =>
	validateClientSourcePolicy({
		sourceFiles,
		publicExports: {},
		files: Object.fromEntries([
			...Object.entries(sourceFiles).map(([path, contents]) => [path, encoder.encode(contents)]),
			["x.css", encoder.encode("")],
			["client/x.css", encoder.encode("")],
			["shared/x.ts", encoder.encode("")],
		]),
	}).map(({ code, file }) => [code, file]);

it("keeps relative script imports inside their client or shared source root", () => {
	for (const [importer, specifier] of [
		["shared/a.ts", "../client/b"],
		["shared/a.ts", "./../client/b"],
		["client/a.ts", "../../x"],
		["client/a.ts", "..//../x"],
		["client/nested/a.ts", "..//..//../x"],
		["shared/a.ts", "..//x"],
	] as const) {
		expect([specifier, diagnose({ [importer]: `import "${specifier}";` })]).toEqual([
			specifier,
			[["RYOT_CLIENT_IMPORT", importer]],
		]);
	}
	expect(
		diagnose({
			"shared/y.ts": 'import "./x";',
			"client/nested/c.ts": 'import "..//b";',
			"client/a.ts": 'import "../shared/x"; import "./b";',
		}),
	).toEqual([]);
});

it("keeps stylesheet imports inside the client source root", () => {
	for (const [importer, specifier] of [
		["client/styles.css", "../../x.css"],
		["client/styles.css", "../x.css"],
		["client/nested/styles.css", "..//..//x.css"],
		["client/styles.css", "./..//x.css"],
	] as const) {
		expect([specifier, diagnose({ [importer]: `@import "${specifier}";` })]).toEqual([
			specifier,
			[["RYOT_CLIENT_STYLES", importer]],
		]);
	}
	expect(diagnose({ "client/nested/styles.css": '@import "..//x.css";' })).toEqual([]);
});

it.each(["client/shared", "client/client", "shared/client", "shared/shared"])(
	"uses the top-level source region for imports and assets under %s",
	(directory) => {
		const shared = directory.startsWith("shared/");
		const script = `${directory}/card.tsx`;
		const stylesheet = `${directory}/styles.css`;
		const region = shared ? "shared" : "client";
		expect(diagnose({ [script]: 'import "../value";' })).toEqual([]);
		expect(diagnose({ [script]: 'import "../../shared/value";' })).toEqual(
			shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
		);
		expect(diagnose({ [script]: 'import "react";' })).toEqual(
			shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
		);
		expect(diagnose({ [script]: 'import "@ryot-app/plugin-kit/effect";' })).toEqual(
			shared ? [] : [["RYOT_CLIENT_IMPORT", script]],
		);
		expect(diagnose({ [script]: 'import "../../client/value";' })).toEqual(
			shared ? [["RYOT_CLIENT_IMPORT", script]] : [],
		);
		expect(diagnose({ [script]: 'import "../../../client/value";' })).toEqual([
			["RYOT_CLIENT_IMPORT", script],
		]);
		expect(diagnose({ [`${region}/x.css`]: "", [stylesheet]: '@import "../x.css";' })).toEqual([]);
		expect(diagnose({ [stylesheet]: '@import "../../../x.css";' })).toEqual([
			["RYOT_CLIENT_STYLES", stylesheet],
		]);
		for (const path of [script, stylesheet]) {
			const asset = (url: string) =>
				path === script
					? `export const image = new URL("${url}", import.meta.url);`
					: `.image { background: url("${url}"); }`;
			const files = { [`${region}/image.svg`]: "<svg/>" };
			expect(diagnose({ ...files, [path]: asset("../image.svg") })).toEqual([]);
			expect(diagnose({ ...files, [path]: asset(`../../../${region}/image.svg`) })).toEqual([
				[path === script ? "RYOT_CLIENT_IMPORT" : "RYOT_CLIENT_STYLES", path],
			]);
		}
	},
);
