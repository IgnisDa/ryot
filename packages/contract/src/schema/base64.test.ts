import { Schema } from "effect";
import { expect, it } from "vitest";

import { CanonicalBase64 } from "./base64";

it("accepts only canonical padded Base64", () => {
	expect(Schema.decodeUnknownSync(CanonicalBase64)("AP+AQQ==")).toBe("AP+AQQ==");
	for (const value of ["AP-AQQ==", "Zg", "Zh==", "AA===", "////\n"]) {
		expect(() => Schema.decodeUnknownSync(CanonicalBase64)(value)).toThrow();
	}
});
