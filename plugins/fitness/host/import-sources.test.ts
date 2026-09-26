import { CreateImportRunBody } from "@ryot-app/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createFitnessImportRunBody, FitnessCreateImportRunBody } from "./import-sources";

const uploadToken = "upload-1";
const timezone = "Asia/Kolkata";
const sources = [
	["open_scale", { uploadToken, source: "open_scale" }],
	["hevy", { timezone, uploadToken, source: "hevy" }],
	["strong_app", { timezone, uploadToken, source: "strong_app" }],
] as const;

it.each(sources)(
	"builds a typed %s request accepted by the open import envelope",
	(source, input) => {
		const body = createFitnessImportRunBody(input);

		expect(Schema.decodeSync(FitnessCreateImportRunBody)(body)).toEqual(body);
		expect(Schema.decodeSync(CreateImportRunBody)(body)).toEqual(body);
		expect(body.source).toBe(source);
	},
);

it.each(["hevy", "strong_app"] as const)("requires a timezone for %s", (source) => {
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({ source, uploadToken }),
	).toThrow();
});

it("keeps fitness-specific request validation strict and contract-owned", () => {
	expect(() =>
		Schema.decodeSync(FitnessCreateImportRunBody)({ timezone, source: "hevy", uploadToken: "" }),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
			source: "hevy",
			uploadToken: { token: "upload-1", expiresAt: "2026-08-23T00:00:00.000Z" },
		}),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
			timezone,
			uploadToken,
			source: "hevy",
			unexpected: true,
		}),
	).toThrow();
});
