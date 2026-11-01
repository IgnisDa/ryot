import { expect, it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";

import { DbError, unknownToDbError, unknownToMessage } from "./errors";

it.each([
	{ label: "Error message", expected: "Request failed", cause: new Error("Request failed") },
	{ cause: "Request failed", expected: "Request failed", label: "plain string failure" },
	{ expected: "TimeoutError", label: "unnamed Effect timeout", cause: new Cause.TimeoutError() },
	{ cause: undefined, expected: "undefined", label: "undefined failure" },
])("converts $label to a message", ({ cause, expected }) => {
	expect(unknownToMessage(cause)).toBe(expected);
});

it.effect(
	"retains database error details across workflow serialization without stack columns",
	() =>
		Effect.gen(function* () {
			const codec = Schema.toCodecJson(DbError);
			const error = new DbError({ message: "Transaction failed" });
			expect(yield* Schema.decodeEffect(codec)(yield* Schema.encodeEffect(codec)(error))).toEqual(
				error,
			);
			expect(error.columnName).toBeUndefined();
			const databaseError = unknownToDbError({
				code: "23502",
				table: "event",
				column: "properties",
				constraint: "event_properties_required",
			});
			expect(
				yield* Schema.decodeEffect(codec)(yield* Schema.encodeEffect(codec)(databaseError)),
			).toEqual(databaseError);
			expect(databaseError.columnName).toBe("properties");
		}),
);
