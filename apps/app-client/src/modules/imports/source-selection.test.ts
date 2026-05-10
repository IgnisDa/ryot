import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { listedImportSource, uploadImportSchema } from "./import-fixture";
import {
	importSourceChooseLabel,
	importSourceEntry,
	importSourceInputShape,
} from "./source-selection";

const serverSchema = {
	unknownKeys: "strict",
	fields: { apiKey: { type: "string", label: "API key", description: "API key" } },
} satisfies AppSchema;

const multiUploadSchema = {
	unknownKeys: "strict",
	fields: {
		historyUploadToken: {
			type: "string",
			label: "History",
			description: "History",
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
		ratingsUploadToken: {
			type: "string",
			label: "Ratings",
			description: "Ratings",
			format: { kind: "upload", allowedFileExtensions: ["csv"] },
		},
	},
} satisfies AppSchema;

describe("source selection", () => {
	it("describes what the service needs from the user", () => {
		expect(importSourceInputShape(serverSchema)).toBe("Server");
		expect(importSourceInputShape(uploadImportSchema())).toBe("CSV file");
		expect(importSourceInputShape(uploadImportSchema({ extensions: ["csv", "zip"] }))).toBe(
			"CSV or ZIP file",
		);
		expect(importSourceInputShape(multiUploadSchema)).toBe("2 files");
	});

	it("maps a source onto a catalog entry carrying its input shape", () => {
		expect(importSourceEntry(listedImportSource({ slug: "netflix", name: "Netflix" }))).toEqual({
			slug: "netflix",
			name: "Netflix",
			badge: "CSV file",
			isAvailable: true,
			requirement: undefined,
			description: "Bring your history over from Netflix",
		});
	});

	it("names the missing server config when that is why a source is unusable", () => {
		expect(
			importSourceEntry(
				listedImportSource({
					slug: "netflix",
					name: "Netflix",
					isStartable: false,
					missingPluginConfigKeys: ["tmdbAccessToken"],
				}),
			).requirement,
		).toBe("Set tmdbAccessToken on your server to use this.");
	});

	it("falls back to a generic reason when no config key is named", () => {
		expect(
			importSourceEntry(
				listedImportSource({ slug: "netflix", name: "Netflix", isStartable: false }),
			).requirement,
		).toBe("This service is not ready on your server yet.");
	});

	it("names the action differently when a source cannot be chosen", () => {
		const source = listedImportSource({ slug: "netflix", name: "Netflix" });

		expect(importSourceChooseLabel(importSourceEntry(source))).toBe("Import from Netflix");
		expect(importSourceChooseLabel(importSourceEntry({ ...source, isStartable: false }))).toBe(
			"Netflix is unavailable",
		);
	});
});
