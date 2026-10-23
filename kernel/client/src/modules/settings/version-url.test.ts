import { describe, expect, it } from "vitest";

import { versionUrl } from "#/modules/settings/version-url";

describe("version url", () => {
	it("links a release tag to its release", () => {
		expect(versionUrl("v10.5.1")).toBe("https://github.com/IgnisDa/ryot/releases/tag/v10.5.1");
	});

	it("links a described version to its commit", () => {
		expect(versionUrl("v10.5.1-4111-g351b4292a3-dirty")).toBe(
			"https://github.com/IgnisDa/ryot/commit/351b4292a3",
		);
	});

	it("links a bare commit to itself", () => {
		expect(versionUrl("351b4292a3")).toBe("https://github.com/IgnisDa/ryot/commit/351b4292a3");
	});

	it("does not link an unknown version", () => {
		expect(versionUrl("unknown")).toBeUndefined();
	});
});
