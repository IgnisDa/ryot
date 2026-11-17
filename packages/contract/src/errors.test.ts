import { expect, test } from "bun:test";

import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Effect, Result, Schema } from "effect";

import {
	badRequest,
	DbError,
	schemaValidationFailed,
	unknownToDbError,
	unknownToMessage,
} from "./errors";

test.each([
	{ label: "Error message", expected: "Request failed", cause: new Error("Request failed") },
	{ cause: "Request failed", expected: "Request failed", label: "plain string failure" },
	{ expected: "TimeoutError", label: "unnamed Effect timeout", cause: new Cause.TimeoutError() },
	{ cause: undefined, expected: "undefined", label: "undefined failure" },
	{
		label: "message reason",
		expected: "error.internal.unexpected",
		cause: badRequest(kernelMessage("error.internal.unexpected")),
	},
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
	testTimeout,
);

test("derives validation issue codes and paths from schema issues", () => {
	const decoded = Schema.decodeUnknownResult(
		Schema.Struct({
			name: Schema.String,
			tags: Schema.Array(Schema.String),
			limit: Schema.Int.check(Schema.isGreaterThan(0)),
		}),
		{ errors: "all", onExcessProperty: "error" },
	)({ limit: 0, extra: true, tags: ["a", 1] });
	if (Result.isSuccess(decoded)) {
		throw new Error("Expected a decoding failure");
	}
	expect(schemaValidationFailed(decoded.failure.issue).issues).toEqual([
		{ path: ["extra"], issue: "unexpected-key" },
		{ path: ["name"], issue: "missing-key" },
		{ path: ["tags", 1], issue: "invalid-type" },
		{ path: ["limit"], issue: "invalid-value" },
	]);
});
