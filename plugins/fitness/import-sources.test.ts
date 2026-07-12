import { CreateImportRunBody } from "@ryot/contract/modules/imports/schemas";
import { Schema } from "effect";
import { expect, it } from "vitest";

import { createFitnessImportRunBody, FitnessCreateImportRunBody } from "./import-sources";

it("builds a typed fitness request accepted by the open import envelope", () => {
	const body = createFitnessImportRunBody({ source: "hevy", uploadToken: "upload-1" });

	expect(Schema.decodeUnknownSync(CreateImportRunBody)(body)).toEqual(body);
	expect(body.source).toBe("hevy");
});

it("keeps fitness-specific request validation in the fitness plugin", () => {
	expect(() =>
		Schema.decodeUnknownSync(FitnessCreateImportRunBody)({ source: "hevy", uploadToken: "" }),
	).toThrow();
});
