import {
	PropertyValidationError,
	type PropertyValidationIssue,
} from "@ryot/contract/schema/property-schema";
import type { Schema } from "effect";
import { SchemaIssue } from "effect";

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

export const formatValidationError = (issues: ReadonlyArray<PropertyValidationIssue>) =>
	issues.map((issue) =>
		issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
	);

export const toValidationError = (issues: ReadonlyArray<PropertyValidationIssue>) =>
	new PropertyValidationError({
		issues: [...issues],
		message: formatValidationError(issues).join("; ") || "Property validation failed",
	});

export const parseErrorToIssues = (
	error: Schema.SchemaError,
): ReadonlyArray<PropertyValidationIssue> =>
	formatIssue(error.issue).issues.map((issue) => ({
		message: issue.message === "Missing key" ? "is missing" : issue.message,
		path: (issue.path ?? []).map((segment) =>
			String(typeof segment === "object" ? segment.key : segment),
		),
	}));
