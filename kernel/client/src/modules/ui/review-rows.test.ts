import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { describe, expect, it } from "vitest";

import { schemaReviewRows } from "./review-rows";

describe("schema review rows", () => {
	it("shows nested labels and choices without exposing secrets or upload tokens", () => {
		const schema: AppSchema = {
			fields: {
				file: {
					position: 1,
					label: "File",
					type: "string",
					description: "File",
					format: { kind: "upload", allowedFileExtensions: ["zip"] },
				},
				accounts: {
					position: 0,
					type: "array",
					label: "Accounts",
					description: "Accounts",
					items: {
						type: "object",
						label: "Account",
						description: "Account",
						properties: {
							name: { label: "Name", type: "string", description: "Name" },
							token: { secret: true, type: "string", label: "Token", description: "Token" },
							access: {
								type: "enum",
								label: "Access",
								description: "Access",
								choices: { kind: "static", values: [{ value: "rw", label: "Read and write" }] },
							},
						},
					},
				},
			},
		};
		expect(
			schemaReviewRows(schema, {
				file: "private-upload-token",
				accounts: [{ access: "rw", name: "Primary", token: "do-not-show" }],
			}),
		).toEqual([
			{ value: "Primary", label: "Accounts 1 / Name" },
			{ value: "Kept hidden", label: "Accounts 1 / Token" },
			{ value: "Read and write", label: "Accounts 1 / Access" },
			{ label: "File", value: "Ready to import" },
		]);
	});
});
