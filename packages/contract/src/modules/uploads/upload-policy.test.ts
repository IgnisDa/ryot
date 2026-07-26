import { describe, expect, it } from "vitest";

import { UPLOAD_MAX_ARCHIVE_BYTES, UPLOAD_MAX_FILE_BYTES, uploadMaxBytes } from "./upload-policy";

describe("upload size policy", () => {
	it("allows the configured archive maximum only for temporary ZIP uploads", () => {
		expect(uploadMaxBytes("temporary", "application/zip")).toBe(UPLOAD_MAX_ARCHIVE_BYTES);
		expect(uploadMaxBytes("permanent", "application/zip")).toBe(UPLOAD_MAX_FILE_BYTES);
		expect(uploadMaxBytes("temporary", "text/csv")).toBe(UPLOAD_MAX_FILE_BYTES);
	});
});
