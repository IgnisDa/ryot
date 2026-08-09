import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { credentialImportSchema, uploadImportSchema } from "./import-fixture";
import { importReviewRows, MASKED_REVIEW_VALUE, UPLOADED_REVIEW_VALUE } from "./review-summary";

const modeSchema = {
	unknownKeys: "strict",
	fields: {
		mode: {
			type: "enum",
			label: "Mode",
			description: "What to bring over",
			choices: {
				kind: "static",
				values: [
					{ value: "all", label: "Everything" },
					{ value: "recent", label: "Recent only" },
				],
			},
		},
		tags: {
			type: "enum-array",
			label: "Tags",
			description: "Tags to apply",
			choices: { kind: "static", values: [{ value: "owned", label: "Owned" }, { value: "wish" }] },
		},
	},
} satisfies AppSchema;

describe("import review rows", () => {
	it("never shows an upload token, only that the file is ready", () => {
		const rows = importReviewRows(uploadImportSchema(), { archiveUploadToken: "tok_secret" });

		expect(rows).toEqual([{ label: "Export archive", value: UPLOADED_REVIEW_VALUE }]);
	});

	it("masks a secret and reads booleans back in words", () => {
		const rows = importReviewRows(credentialImportSchema, {
			includeArchived: true,
			apiKey: "key_live_1234",
		});

		expect(rows).toEqual([
			{ label: "API key", value: MASKED_REVIEW_VALUE },
			{ label: "Include archived", value: "Yes" },
		]);
	});

	it("shows choice labels instead of stored values", () => {
		expect(importReviewRows(modeSchema, { mode: "recent", tags: ["owned", "wish"] })).toEqual([
			{ label: "Mode", value: "Recent only" },
			{ label: "Tags", value: "Owned, wish" },
		]);
	});

	it("leaves out anything the person did not fill in", () => {
		expect(
			importReviewRows(credentialImportSchema, { apiKey: "", includeArchived: false }),
		).toEqual([{ label: "Include archived", value: "No" }]);
		expect(importReviewRows(modeSchema, { tags: [] })).toEqual([]);
	});
});
