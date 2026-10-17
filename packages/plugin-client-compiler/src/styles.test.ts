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
