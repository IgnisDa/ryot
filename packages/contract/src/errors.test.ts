import { Schema } from "effect";
import { expect, it } from "vitest";

import { DbError, unknownToDbError } from "./errors";

it("retains database error details across workflow serialization without stack columns", () => {
	const codec = Schema.toCodecJson(DbError);
	const error = new DbError({ message: "Transaction failed" });
	expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(error))).toEqual(error);
	expect(error.columnName).toBeUndefined();
	const databaseError = unknownToDbError({
		code: "23502",
		table: "event",
		column: "properties",
		constraint: "event_properties_required",
	});
	expect(Schema.decodeSync(codec)(Schema.encodeSync(codec)(databaseError))).toEqual(databaseError);
	expect(databaseError.columnName).toBe("properties");
});
