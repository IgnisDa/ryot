import { describe, expect, it } from "bun:test";

import { testKernelText, testText } from "@ryot-app/kernel-messages/testing";

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
			[importRunSourceKey("first", "common"), testText("First Source")],
			[importRunSourceKey("second", "common"), testText("Second Source")],
		]);
		const name = (pluginInstallationId: null | string) =>
			importSourceName(testKernelText, { source: "common", pluginInstallationId }, names);

		expect<string>(name("second")).toBe("Second Source");
		expect<string>(name(null)).toBe("Unknown source");
	});
});
