import type { FilterOperator, FilterRule } from "@ryot-app/contract/modules/filters/schemas";
import {
	NamedQuery as AuthoredQuery,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLDocument as ExecutableDocument } from "@ryot-app/contract/modules/ryotql/language";
import { authoredValidationBranches } from "@ryot-app/ryotql/binding";
import { filterOperatorsFor, type FilterTarget } from "@ryot-app/ryotql/filters";
import { Result, Schema } from "effect";

import type { RyotQLAccess } from "./catalog";
import {
	compileControlFilter,
	compileControlSort,
	type ControlSchema,
	resolveControl,
} from "./controls";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "./validator";

const controlQuery = (query: ExecutableDocument["queries"][string]) =>
	Schema.decodeResult(AuthoredQuery)({
		...query,
		output:
			query.output.type === "rows"
				? {
						...query.output,
						pagination: { ...query.output.pagination, maxLimit: query.output.pagination.limit },
					}
				: { ...query.output, limit: query.output.limit ?? 1, maxLimit: query.output.limit ?? 1 },
	});

const semanticIssue = (input: unknown, access: RyotQLAccess): Error | undefined => {
	const decoded = Schema.decodeUnknownResult(ExecutableDocument)(input);
	if (Result.isFailure(decoded)) {
		return new Error("Control did not produce an executable query", { cause: decoded.failure });
	}
	const { error } = validateRyotQLDocument(decoded.success, access);
	return error === null ? undefined : new Error(error);
};

const filterSample = (operator: FilterOperator, spec: FilterTarget["spec"]): FilterRule => {
	const field = spec.key;
	switch (operator) {
		case "eq":
		case "gte":
		case "lte":
			return { field, operator, value: 1 };
		case "is":
		case "contains":
		case "notContains":
			return { field, operator, value: "sample" };
		case "empty":
		case "isTrue":
		case "isFalse":
		case "notEmpty":
			return { field, operator };
		case "after":
		case "before":
			return { field, operator, value: "2026-01-01" };
		case "anyOf":
		case "allOf":
		case "noneOf": {
			const value =
				spec.kind === "value" && (spec.type === "enum" || spec.type === "enum-list")
					? spec.choices[0].value
					: "sample";
			return { field, operator, values: [value] };
		}
		case "between":
			return { field, min: 1, max: 2, operator };
		case "betweenDates":
			return { field, operator, to: "2026-01-02", from: "2026-01-01" };
		case "withinLastDays":
			return { field, days: 1, operator };
		default:
			return operator satisfies never;
	}
};

export const storedValidationBranches = (
	document: RyotQLDocument,
	schemas: readonly ControlSchema[],
	access: RyotQLAccess = savedViewDataSourceAccess,
): Result.Result<readonly ExecutableDocument[], Error> => {
	const projections = authoredValidationBranches(document, {
		now: new Date(0),
		maximumBranches: 256,
		reportingTimeZone: "UTC",
		sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity:validation" }),
	});
	if (Result.isFailure(projections)) {
		return Result.fail(projections.failure);
	}
	for (const branch of projections.success) {
		const issue = semanticIssue(branch, access);
		if (issue) {
			return Result.fail(issue);
		}
		const queries = Result.all(
			Object.entries(branch.queries).map(([name, query]) =>
				Result.map(controlQuery(query), (value) => [name, value] as const),
			),
		);
		if (Result.isFailure(queries)) {
			return Result.fail(new Error("Invalid control projection", { cause: queries.failure }));
		}
		const fullDocument = { ...document, queries: Object.fromEntries(queries.success) };
		for (const [name, query] of Object.entries(branch.queries)) {
			const source = fullDocument.queries[name];
			if (!source) {
				return Result.fail(new Error("Missing control source"));
			}
			for (const [kind, target] of Object.entries(document.controls ?? {})) {
				const controls = resolveControl(target, source, schemas, fullDocument);
				if (Result.isFailure(controls)) {
					return Result.fail(controls.failure);
				}
				if (kind === "sort") {
					for (const sort of controls.success.sorts) {
						for (const direction of ["asc", "desc"]) {
							const order = compileControlSort(controls.success, `${sort.key}-${direction}`);
							if (Result.isFailure(order)) {
								return Result.fail(order.failure);
							}
							if (query.output.type !== "rows") {
								continue;
							}
							const check = semanticIssue(
								{
									queries: {
										[name]: { ...query, output: { ...query.output, orderBy: order.success } },
									},
								},
								access,
							);
							if (check) {
								return Result.fail(check);
							}
						}
					}
				}
				for (const filter of controls.success.filters) {
					for (const operator of filterOperatorsFor(filter.spec)) {
						const predicate = compileControlFilter(
							{ ...controls.success, filters: [filter] },
							source,
							filterSample(operator, filter.spec),
							new Date(0),
						);
						if (Result.isFailure(predicate)) {
							return Result.fail(predicate.failure);
						}
						const predicateIssue = semanticIssue(
							{ queries: { [name]: { ...query, where: predicate.success } } },
							access,
						);
						if (predicateIssue) {
							return Result.fail(predicateIssue);
						}
					}
					for (const targetBranch of filter.branches) {
						if (targetBranch.value === undefined) {
							continue;
						}
						const branchIssue = semanticIssue(
							{
								queries: {
									[name]: {
										...query,
										output: {
											orderBy: [],
											type: "rows",
											pagination: { limit: 1 },
											fields: [{ key: "value", expr: targetBranch.value }],
										},
									},
								},
							},
							access,
						);
						if (branchIssue) {
							return Result.fail(branchIssue);
						}
					}
				}
			}
		}
	}
	return Result.succeed(projections.success);
};
