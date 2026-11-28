import type {
	FieldSelection,
	Predicate,
	RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import type { RowsResult } from "@ryot-app/contract/modules/ryotql/language";
import { FieldSelection as ExecutableFieldSelection } from "@ryot-app/contract/modules/ryotql/language";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { Result, Schema } from "effect";

import {
	authoredValidationBranches,
	bindDocument,
	type BindingContext,
	type StoredValidationContext,
	validateAuthoredDocument,
} from "./binding";
import type { RyotQLAccess } from "./catalog";
import { validateRyotQLDocument } from "./validator";

export const bindAuthored = (
	document: RyotQLDocument,
	values: Omit<ExecutionRequest, "source">,
	context: BindingContext,
) =>
	Result.flatMap(validateAuthoredDocument(document), (validated) =>
		bindDocument(validated, values, context),
	);

export const authoredBranches = (document: RyotQLDocument, context: StoredValidationContext) =>
	Result.flatMap(validateAuthoredDocument(document), (validated) =>
		authoredValidationBranches(validated, context),
	);

export const validateAuthoredFixture = (
	document: RyotQLDocument,
	scope: RyotQLAccess,
	values: Omit<ExecutionRequest, "source"> = {},
) => {
	const bound = bindAuthored(document, values, { now: new Date(0), reportingTimeZone: "UTC" });
	return Result.isFailure(bound)
		? { value: null, error: bound.failure.message }
		: validateRyotQLDocument(bound.success.document, scope);
};

export const executableFixture = (document: RyotQLDocument) =>
	Result.getOrThrow(bindAuthored(document, {}, { now: new Date(0), reportingTimeZone: "UTC" }))
		.document;

export const executableFieldsFixture = (fields: readonly FieldSelection[]) => {
	const result = executableFixture({
		queries: {
			fixture: {
				from: { table: "entity", alias: "fixture" },
				output: { fields, orderBy: [], type: "rows", pagination: { limit: 1, maxLimit: 1 } },
			},
		},
	}).queries["fixture"];
	if (result?.output.type !== "rows") {
		throw new Error("Expected rows fixture");
	}
	return Result.getOrThrow(
		Schema.decodeUnknownResult(Schema.Array(ExecutableFieldSelection))(result.output.fields),
	);
};
export const executablePredicateFixture = (where: Predicate) =>
	executableFixture({
		queries: {
			fixture: {
				where,
				from: { table: "entity", alias: "fixture" },
				output: { fields: [], orderBy: [], type: "rows", pagination: { limit: 1, maxLimit: 1 } },
			},
		},
	}).queries["fixture"]?.where;

export const cursorPageContents = (result: RowsResult) => ({
	...result,
	pageInfo: {
		limit: result.pageInfo.limit,
		hasMore: result.pageInfo.hasMore,
		hasCursor: result.pageInfo.nextCursor !== null,
	},
});
