import {
	PropertyValidationError,
	type PropertyValidationIssue,
} from "@ryot/contract/schema/property-schema";
import { ParseResult } from "effect";

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
	error: ParseResult.ParseError,
): ReadonlyArray<PropertyValidationIssue> =>
	ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) => ({
		path: issue.path.map((segment) => String(segment)),
		message: issue.message,
	}));
