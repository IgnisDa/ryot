import { describe, expect, it } from "bun:test";
import { createValidationErrorResult } from "~/lib/openapi";
import {
	ViewRuntimeNotFoundError,
	ViewRuntimeValidationError,
} from "~/lib/views/errors";
import { resolveSavedViewValidationErrorResult } from "./routes";

describe("resolveSavedViewValidationErrorResult", () => {
	it("maps known saved-view validation errors to validation responses", () => {
		expect(
			resolveSavedViewValidationErrorResult(
				new ViewRuntimeValidationError("Invalid property reference"),
			),
		).toEqual(createValidationErrorResult("Invalid property reference"));

		expect(
			resolveSavedViewValidationErrorResult(
				new ViewRuntimeNotFoundError("Schema 'missing' not found"),
			),
		).toEqual(createValidationErrorResult("Schema 'missing' not found"));
	});

	it("rethrows unexpected errors", () => {
		expect(() =>
			resolveSavedViewValidationErrorResult(new Error("Database offline")),
		).toThrow("Database offline");
	});
});
