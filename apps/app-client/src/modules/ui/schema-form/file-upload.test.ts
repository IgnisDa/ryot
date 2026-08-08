import { describe, expect, it } from "vitest";

import {
	allowedFileExtensionsLabel,
	fileAcceptAttribute,
	formatFileSize,
	isAllowedUploadFileName,
	unsupportedFileExtensionMessage,
} from "./file-upload";

describe("upload file extensions", () => {
	it("accepts allowed extensions regardless of case and surrounding space", () => {
		expect(isAllowedUploadFileName("  Trakt-Export.ZIP  ", ["zip"])).toBe(true);
		expect(isAllowedUploadFileName("history.csv", ["gz", "csv"])).toBe(true);
		expect(isAllowedUploadFileName("archive.tar.gz", ["tar.gz"])).toBe(true);
	});

	it("rejects other extensions, missing extensions, and bare extensions", () => {
		expect(isAllowedUploadFileName("history.csv", ["zip"])).toBe(false);
		expect(isAllowedUploadFileName("history", ["csv"])).toBe(false);
		expect(isAllowedUploadFileName(".csv", ["csv"])).toBe(false);
		expect(isAllowedUploadFileName("historycsv", ["csv"])).toBe(false);
	});

	it("describes accepted extensions for copy and for the web accept attribute", () => {
		expect(allowedFileExtensionsLabel(["zip"])).toBe(".zip");
		expect(allowedFileExtensionsLabel(["gz", "xml"])).toBe(".gz or .xml");
		expect(allowedFileExtensionsLabel(["csv", "gz", "xml"])).toBe(".csv, .gz or .xml");
		expect(fileAcceptAttribute(["csv", "gz"])).toBe(".csv,.gz");
		expect(unsupportedFileExtensionMessage(["zip"])).toBe("Choose a .zip file.");
	});
});

describe("formatFileSize", () => {
	it("formats byte counts with a single scaled unit", () => {
		expect(formatFileSize(0)).toBe("0 B");
		expect(formatFileSize(940)).toBe("940 B");
		expect(formatFileSize(2048)).toBe("2.0 KB");
		expect(formatFileSize(1_572_864)).toBe("1.5 MB");
		expect(formatFileSize(52_428_800)).toBe("50 MB");
	});
});
