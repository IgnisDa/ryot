import { describe, expect, it } from "bun:test";
import { createValidationErrorResult } from "~/lib/openapi";
import {
	QueryEngineNotFoundError,
	QueryEngineValidationError,
} from "~/lib/views/errors";
import { resolveSavedViewValidationErrorResult } from "./routes";

describe("resolveSavedViewValidationErrorResult", () => {
	it("maps known saved-view validation errors to validation responses", () => {
		expect(
			resolveSavedViewValidationErrorResult(
				new QueryEngineValidationError("Invalid property reference"),
			),
		).toEqual(createValidationErrorResult("Invalid property reference"));

		expect(
			resolveSavedViewValidationErrorResult(
				new QueryEngineNotFoundError("Schema 'missing' not found"),
			),
		).toEqual(createValidationErrorResult("Schema 'missing' not found"));
	});

	it("rethrows unexpected errors", () => {
		expect(() =>
			resolveSavedViewValidationErrorResult(new Error("Database offline")),
		).toThrow("Database offline");
	});
});
