import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { schemaReviewRows, MASKED_REVIEW_VALUE, UPLOADED_REVIEW_VALUE } from "./review-summary";

const uploadImportSchema = () =>
	({
		unknownKeys: "strict",
		fields: {
			archiveUploadToken: {
				type: "string",
				label: "Export archive",
				validation: { required: true },
				description: "The export file from your account",
				format: { kind: "upload", allowedFileExtensions: ["csv"] },
			},
		},
	}) satisfies AppSchema;

const credentialImportSchema = {
	unknownKeys: "strict",
	fields: {
		apiKey: {
			secret: true,
			type: "string",
			label: "API key",
			validation: { required: true },
			description: "The key from your account settings",
		},
		includeArchived: {
			type: "boolean",
			defaultValue: false,
			label: "Include archived",
			description: "Also bring over archived entries",
		},
	},
} satisfies AppSchema;

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
			label: "Tags",
			type: "enum-array",
			description: "Tags to apply",
			choices: { kind: "static", values: [{ value: "owned", label: "Owned" }, { value: "wish" }] },
		},
	},
} satisfies AppSchema;

describe("import review rows", () => {
	it("never shows an upload token, only that the file is ready", () => {
		const rows = schemaReviewRows(uploadImportSchema(), { archiveUploadToken: "tok_secret" });

		expect(rows).toEqual([{ label: "Export archive", value: UPLOADED_REVIEW_VALUE }]);
	});

	it("masks a secret and reads booleans back in words", () => {
		const rows = schemaReviewRows(credentialImportSchema, {
			includeArchived: true,
			apiKey: "key_live_1234",
		});

		expect(rows).toEqual([
			{ label: "API key", value: MASKED_REVIEW_VALUE },
			{ label: "Include archived", value: "Yes" },
		]);
	});

	it("shows choice labels instead of stored values", () => {
		expect(schemaReviewRows(modeSchema, { mode: "recent", tags: ["owned", "wish"] })).toEqual([
			{ label: "Mode", value: "Recent only" },
			{ label: "Tags", value: "Owned, wish" },
		]);
	});

	it("leaves out anything the person did not fill in", () => {
		expect(
			schemaReviewRows(credentialImportSchema, { apiKey: "", includeArchived: false }),
		).toEqual([{ label: "Include archived", value: "No" }]);
		expect(schemaReviewRows(modeSchema, { tags: [] })).toEqual([]);
	});
});
