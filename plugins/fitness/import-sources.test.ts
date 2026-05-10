import { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createFitnessImportRunBody, FitnessCreateImportRunBody } from "./import-sources";

const uploadToken = { token: "upload-1", expiresAt: "2026-08-23T00:00:00.000Z" } as const;
const sources = ["hevy", "strong_app", "open_scale"] as const;

it.each(sources)("builds a typed %s request accepted by the open import envelope", (source) => {
	const body = createFitnessImportRunBody({ source, uploadToken });

	expect(Schema.decodeUnknownSync(FitnessCreateImportRunBody)(body)).toEqual(body);
	expect(Schema.decodeUnknownSync(CreateImportRunBody)(body)).toEqual(body);
	expect(body.source).toBe(source);
});

it("keeps fitness-specific request validation strict and contract-owned", () => {
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
			source: "hevy",
			uploadToken: "upload-1",
		}),
	).toThrow();
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({
			uploadToken,
			source: "hevy",
			unexpected: true,
		}),
	).toThrow();
});
