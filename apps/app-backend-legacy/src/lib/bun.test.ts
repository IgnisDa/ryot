import { describe, expect, it } from "bun:test";

import { getTemporaryDirectory, joinTemporaryDirectoryPath } from "./bun";

describe("getTemporaryDirectory", () => {
	it("skips empty env values", () => {
		expect(getTemporaryDirectory({ TMPDIR: "", TEMP: "", TMP: "/custom/tmp" })).toBe("/custom/tmp");
	});

	it("falls back when temp env vars are blank", () => {
		expect(getTemporaryDirectory({ TMPDIR: "", TEMP: "", TMP: "" })).toBe("/tmp");
	});

	it("prefers TMP over TEMP on posix", () => {
		expect(
			getTemporaryDirectory({ TMPDIR: "", TMP: "/tmp/from-tmp", TEMP: "/tmp/from-temp" }),
		).toBe("/tmp/from-tmp");
	});
});

describe("joinTemporaryDirectoryPath", () => {
	it("trims trailing separators", () => {
		expect(joinTemporaryDirectoryPath("/tmp/", "file.txt")).toBe("/tmp/file.txt");
	});
});
