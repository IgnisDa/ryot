import { describe, expect, it } from "vitest";

import { canCancelImportRun, canDeleteImportRun } from "./run-presentation";

describe("import run actions", () => {
	it("allows blocked runs to be cancelled and expired runs to be deleted", () => {
		expect(canCancelImportRun("blocked")).toBe(true);
		expect(canCancelImportRun("expired")).toBe(false);
		expect(canDeleteImportRun("blocked")).toBe(false);
		expect(canDeleteImportRun("expired")).toBe(true);
	});
});
