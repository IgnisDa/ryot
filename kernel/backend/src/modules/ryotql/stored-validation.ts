import {
	NamedQuery as AuthoredQuery,
	type RyotQLDocument,
} from "@ryot-app/contract/modules/ryotql/authored";
import {
	OrderBy,
	Predicate,
	RowsOutput,
	type RyotQLDocument as ExecutableDocument,
} from "@ryot-app/contract/modules/ryotql/language";
import { authoredValidationBranches, storedValidationContext } from "@ryot-app/ryotql/binding";
import { filterOperatorsFor, sampleFilterRule } from "@ryot-app/ryotql/filters";
import { Result, Schema } from "effect";

import type { RyotQLAccess } from "./catalog";
import {
	compileControlFilter,
	compileControlSort,
	type ControlSchema,
	resolveControl,
} from "./controls";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "./validator";

type ExecutableQuery = ExecutableDocument["queries"][string];

const controlQuery = (query: ExecutableQuery) =>
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

const decodePredicate = Schema.decodeUnknownResult(Predicate);
const decodeOrderBy = Schema.decodeUnknownResult(Schema.Array(OrderBy));
const decodeRowsOutput = Schema.decodeUnknownResult(RowsOutput);

const accessIssue = (document: ExecutableDocument, access: RyotQLAccess): Error | undefined => {
	const { error } = validateRyotQLDocument(document, access);
	return error === null ? undefined : new Error(error);
};

const executableIssue = (cause: unknown) =>
	new Error("Control did not produce an executable query", { cause });

const querySampleIssue = (
	name: string,
	query: ExecutableQuery,
	access: RyotQLAccess,
): Error | undefined => accessIssue({ queries: { [name]: query } }, access);

export const storedValidationBranches = (
	document: RyotQLDocument,
	schemas: readonly ControlSchema[],
	access: RyotQLAccess = savedViewDataSourceAccess,
): Result.Result<readonly ExecutableDocument[], Error> => {
	const projections = authoredValidationBranches(document, storedValidationContext());
	if (Result.isFailure(projections)) {
		return Result.fail(projections.failure);
	}
	const controlTargets = Object.entries(document.controls ?? {});
	for (const branch of projections.success) {
		const issue = accessIssue(branch, access);
		if (issue) {
			return Result.fail(issue);
		}
		if (controlTargets.length === 0) {
			continue;
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
			for (const [kind, target] of controlTargets) {
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
							const orderBy = decodeOrderBy(order.success);
							if (Result.isFailure(orderBy)) {
								return Result.fail(executableIssue(orderBy.failure));
							}
							const check = querySampleIssue(
								name,
								{ ...query, output: { ...query.output, orderBy: orderBy.success } },
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
							sampleFilterRule(operator, filter.spec),
							new Date(0),
						);
						if (Result.isFailure(predicate)) {
							return Result.fail(predicate.failure);
						}
						const where = decodePredicate(predicate.success);
						if (Result.isFailure(where)) {
							return Result.fail(executableIssue(where.failure));
						}
						const predicateIssue = querySampleIssue(
							name,
							{ ...query, where: where.success },
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
						const output = decodeRowsOutput({
							orderBy: [],
							type: "rows",
							pagination: { limit: 1 },
							fields: [{ key: "value", expr: targetBranch.value }],
						});
						if (Result.isFailure(output)) {
							return Result.fail(executableIssue(output.failure));
						}
						const branchIssue = querySampleIssue(
							name,
							{ ...query, output: output.success },
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
