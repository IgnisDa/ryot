import { describe, expect, it } from "vitest";

import {
	canCancelImportRun,
	canDeleteImportRun,
	importRunSourceKey,
	importSourceName,
} from "./run-presentation";

describe("import run actions", () => {
	it("allows blocked runs to be cancelled and expired runs to be deleted", () => {
		expect(canCancelImportRun("blocked")).toBe(true);
		expect(canCancelImportRun("expired")).toBe(false);
		expect(canDeleteImportRun("blocked")).toBe(false);
		expect(canDeleteImportRun("expired")).toBe(true);
	});
});

describe("import run source names", () => {
	it("names a run after the source of its own installation", () => {
		const names = new Map([
			[importRunSourceKey("first", "common"), "First Source"],
			[importRunSourceKey("second", "common"), "Second Source"],
		]);

		expect(importSourceName({ source: "common", pluginInstallationId: "second" }, names)).toBe(
			"Second Source",
		);
		expect(importSourceName({ source: "common", pluginInstallationId: null }, names)).toBe(
			"Common",
		);
	});
});
