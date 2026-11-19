import * as Authored from "@ryot-app/contract/modules/ryotql/authored";
import {
	type AggregateOrderBy,
	RyotQLDocument,
	type TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	argumentIssuesMessage,
	bindArguments,
	validateParameterSchema,
} from "@ryot-app/contract/modules/ryotql/parameters";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import {
	type AppPropertyDefinition,
	type AppSchemaFields,
	isMissingAppSchemaRequiredValue,
} from "@ryot-app/contract/schema/property-schema";
import { isNamedTimeZone } from "@ryot-app/contract/schema/time-zone";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { isObjectRecord, isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { Result, Schema } from "effect";

import { queryPaging } from "./paging";

const decodeDocument = (input: unknown) =>
	Result.mapError(
		Schema.decodeUnknownResult(RyotQLDocument)(input),
		(error) => new Error(`Invalid executable document: ${error.message}`),
	);

const fail = (message: string) => Result.fail(new Error(message));
const units = new Set(["day", "hour", "week", "year", "month"]);
const isList = (property: AppPropertyDefinition) =>
	property.type === "array" || property.type === "enum-array";
const isSet = (value: unknown) => value !== undefined && !isMissingAppSchemaRequiredValue(value);

export const validateAuthoredDocument = (
	document: Authored.RyotQLDocument,
): Result.Result<void, Error> => {
	const decoded = Schema.decodeResult(Authored.RyotQLDocument)(document);
	if (Result.isFailure(decoded)) {
		return fail("Invalid authored document shape");
	}
	const issues =
		document.parameters === undefined ? [] : validateParameterSchema(document.parameters);
	if (issues.length > 0) {
		return fail(issues.map(({ path, message }) => `${path.join(".")}: ${message}`).join("; "));
	}
	const fields = document.parameters?.fields ?? {};
	const visit = (
		value: unknown,
		slot: string,
		guarded: ReadonlySet<string>,
	): Result.Result<void, Error> => {
		if (isUnknownArray(value)) {
			return Result.map(
				Result.all(value.map((child) => visit(child, "element", guarded))),
				() => undefined,
			);
		}
		if (!isObjectRecord(value)) {
			return Result.succeed(undefined);
		}
		if (value["type"] === "literal") {
			return Result.succeed(undefined);
		}
		if (value["type"] === "parameter" || value["type"] === "sourceEntity") {
			const name = value[value["type"] === "parameter" ? "name" : "parameter"];
			const property =
				typeof name === "string" && Object.hasOwn(fields, name) ? fields[name] : undefined;
			if (!property || typeof name !== "string") {
				return fail(`Undeclared parameter '${String(name)}'`);
			}
			if (
				!property.validation?.required &&
				property.defaultValue === undefined &&
				!guarded.has(name)
			) {
				return fail(`Optional parameter '${name}' must be inside its whenSet branch`);
			}
			if (value["type"] === "sourceEntity") {
				return property.type === "string" && property.reference?.kind === "entity-source"
					? Result.succeed(undefined)
					: fail(`Source parameter '${name}' requires an entity-source reference`);
			}
			if (slot === "values") {
				return isList(property)
					? Result.succeed(undefined)
					: fail(`Parameter '${name}' must be a list`);
			}
			if (isList(property)) {
				return fail(`List parameter '${name}' is only valid in in.values`);
			}
			if (slot === "amount" && property.type !== "number" && property.type !== "integer") {
				return fail(`Date amount '${name}' must be numeric`);
			}
			if (
				slot === "timeZone" &&
				property.type === "enum" &&
				property.choices.kind === "static" &&
				property.choices.values.some((choice) => !isNamedTimeZone(choice.value))
			) {
				return fail(`Time zone parameter '${name}' contains an invalid zone`);
			}
			if (slot === "timeZone" && property.type !== "string" && property.type !== "enum") {
				return fail(`Time zone '${name}' must be a string`);
			}
			if (
				slot === "bucket" &&
				(property.type !== "enum" ||
					property.choices.kind !== "static" ||
					property.choices.values.some((choice) => !units.has(choice.value)))
			) {
				return fail(`Bucket parameter '${name}' must enumerate date bucket units`);
			}
			return Result.succeed(undefined);
		}
		if (value["type"] === "whenSet") {
			const name = value["parameter"];
			const property =
				typeof name === "string" && Object.hasOwn(fields, name) ? fields[name] : undefined;
			if (
				!property ||
				typeof name !== "string" ||
				property.validation?.required ||
				property.defaultValue !== undefined
			) {
				return fail("whenSet requires an optional parameter without a default");
			}
			return visit(value["predicate"], "predicate", new Set([...guarded, name]));
		}
		if (value["type"] === "choice") {
			const name = value["parameter"];
			const property =
				typeof name === "string" && Object.hasOwn(fields, name) ? fields[name] : undefined;
			const cases = value["cases"];
			if (
				property?.type !== "enum" ||
				property.choices.kind !== "static" ||
				!isObjectRecord(cases)
			) {
				return fail("choice requires a static enum parameter");
			}
			if (
				!property.validation?.required &&
				property.defaultValue === undefined &&
				(typeof name !== "string" || !guarded.has(name))
			) {
				return fail("choice requires a set parameter");
			}
			const expected = property.choices.values.map((choice) => choice.value);
			if (
				Object.keys(cases).length !== expected.length ||
				expected.some((key) => !Object.hasOwn(cases, key))
			) {
				return fail("choice cases must cover exactly the enum choices");
			}
			return Result.map(
				Result.all(Object.values(cases).map((branch) => visit(branch, slot, guarded))),
				() => undefined,
			);
		}
		if (value["type"] === "filter" && document.controls?.filter === undefined) {
			return fail("filter requires a declared control");
		}
		if (value["type"] === "sort" && document.controls?.sort === undefined) {
			return fail("sort requires a declared control");
		}
		return Result.map(
			Result.all(Object.entries(value).map(([key, child]) => visit(child, key, guarded))),
			() => undefined,
		);
	};
	for (const [name, query] of Object.entries(document.queries)) {
		const output = query.output;
		const limit = output.type === "rows" ? output.pagination : output;
		if (limit.maxLimit === undefined || limit.limit === undefined || limit.limit > limit.maxLimit) {
			return fail(`Query '${name}' requires a default limit no greater than maxLimit`);
		}
	}
	return visit(document.queries, "queries", new Set());
};

export type BindingContext = {
	readonly now: Date;
	readonly reportingTimeZone: string;
	readonly resolveSourceEntity?: (
		reference: string,
		alias: string,
		parameter: string,
	) => Result.Result<TableReference, Error>;
	readonly sort?: (
		query: string,
		target: Authored.Controls["sort"],
		value: string,
	) => Result.Result<readonly Authored.OrderBy[] | readonly AggregateOrderBy[], Error>;
	readonly filter?: (
		query: string,
		target: Authored.Controls["filter"],
		value: NonNullable<ExecutionRequest["filter"]>,
	) => Result.Result<undefined | Authored.Predicate, Error>;
};

type RequestValues = Omit<ExecutionRequest, "source">;

const parameterLiteral = (
	value: unknown,
	property: undefined | Pick<AppPropertyDefinition, "type">,
): unknown => {
	const expr = { value, type: "literal" };
	return property?.type === "date" || property?.type === "datetime"
		? { expr, type: "cast", target: "date" }
		: expr;
};

const materialize = (
	value: unknown,
	slot: string,
	boundArguments: Readonly<Record<string, unknown>>,
	context: BindingContext,
	filter: undefined | Authored.Predicate,
	sort: undefined | readonly Authored.OrderBy[] | readonly AggregateOrderBy[],
	fields: AppSchemaFields,
): Result.Result<unknown, Error> => {
	const recur = (child: unknown, key: string) =>
		materialize(child, key, boundArguments, context, filter, sort, fields);
	if (isUnknownArray(value)) {
		return Result.all(value.map((child) => recur(child, "element")));
	}
	if (!isObjectRecord(value) || value["type"] === "literal") {
		return Result.succeed(value);
	}
	switch (value["type"]) {
		case "now":
			return Number.isFinite(context.now.getTime())
				? Result.succeed(parameterLiteral(context.now.toISOString(), { type: "datetime" }))
				: fail("Invalid execution clock");
		case "sort":
			return sort === undefined ? recur(value["otherwise"], slot) : recur(sort, slot);
		case "choice": {
			const name = value["parameter"];
			const chosen =
				typeof name === "string" && Object.hasOwn(boundArguments, name)
					? boundArguments[name]
					: undefined;
			const cases = value["cases"];
			return typeof chosen === "string" && isObjectRecord(cases) && Object.hasOwn(cases, chosen)
				? recur(cases[chosen], slot)
				: fail("No choice case for bound argument");
		}
		case "filter":
			return recur(filter ?? { type: "and", predicates: [] }, slot);
		case "whenSet":
			return typeof value["parameter"] === "string" && isSet(boundArguments[value["parameter"]])
				? recur(value["predicate"], slot)
				: Result.succeed({ type: "and", predicates: [] });
		case "context":
			return Result.succeed(context.reportingTimeZone);
		case "parameter": {
			const name = value["name"];
			const argument =
				typeof name === "string" && Object.hasOwn(boundArguments, name)
					? boundArguments[name]
					: undefined;
			const property =
				typeof name === "string" && Object.hasOwn(fields, name) ? fields[name] : undefined;
			if (argument === undefined) {
				return fail(`Parameter '${String(name)}' is unset`);
			}
			if (slot === "values") {
				return isUnknownArray(argument)
					? Result.succeed(
							argument.map((item) =>
								parameterLiteral(item, property?.type === "array" ? property.items : undefined),
							),
						)
					: fail("Expected list argument");
			}
			return Result.succeed(
				slot === "timeZone" || slot === "bucket" || slot === "amount"
					? argument
					: parameterLiteral(argument, property),
			);
		}
		case "sourceEntity": {
			const name = value["parameter"];
			const reference =
				typeof name === "string" && Object.hasOwn(boundArguments, name)
					? boundArguments[name]
					: undefined;
			return typeof name === "string" &&
				typeof reference === "string" &&
				typeof value["alias"] === "string" &&
				context.resolveSourceEntity !== undefined
				? context.resolveSourceEntity(reference, value["alias"], name)
				: fail("Source entity resolution is required");
		}
	}
	return Result.map(
		Result.all(
			Object.entries(value).map(([key, child]) =>
				Result.map(recur(child, key), (bound) => [key, bound] as const),
			),
		),
		Object.fromEntries,
	);
};

export const bindDocument = (
	document: Authored.RyotQLDocument,
	values: RequestValues,
	context: BindingContext,
): Result.Result<
	{ readonly document: RyotQLDocument; readonly arguments: Readonly<Record<string, unknown>> },
	Error
> =>
	Result.flatMap(validateAuthoredDocument(document), () =>
		Result.flatMap(
			Result.mapError(
				bindArguments(document.parameters, values.arguments),
				(issues) => new Error(argumentIssuesMessage(issues)),
			),
			(boundArguments) => {
				if (
					values.filter !== undefined &&
					(document.controls?.filter === undefined || context.filter === undefined)
				) {
					return fail("Filter control resolution is required");
				}
				if (
					values.sort !== undefined &&
					(document.controls?.sort === undefined || context.sort === undefined)
				) {
					return fail("Sort control resolution is required");
				}
				if (
					Object.keys(values.pages ?? {}).some((name) => !Object.hasOwn(document.queries, name))
				) {
					return fail("Page references an unknown query");
				}
				return Result.flatMap(
					Result.all(
						Object.entries(document.queries).map(([name, query]) => {
							const filter =
								values.filter !== undefined && context.filter !== undefined
									? context.filter(name, document.controls?.filter, values.filter)
									: Result.succeed(undefined);
							const sort =
								values.sort !== undefined && context.sort !== undefined
									? context.sort(name, document.controls?.sort, values.sort)
									: Result.succeed(undefined);
							return Result.flatMap(Result.all({ sort, filter }), (controls) =>
								Result.flatMap(
									materialize(
										query,
										"query",
										boundArguments,
										context,
										controls.filter,
										controls.sort,
										document.parameters?.fields ?? {},
									),
									(bound) => {
										if (!isObjectRecord(bound) || !isObjectRecord(bound["output"])) {
											return fail("Malformed bound query");
										}
										const output = bound["output"];
										const pagination = output["type"] === "rows" ? output["pagination"] : output;
										if (
											!isObjectRecord(pagination) ||
											typeof pagination["limit"] !== "number" ||
											typeof pagination["maxLimit"] !== "number"
										) {
											return fail("Malformed query limits");
										}
										const page = values.pages?.[name];
										const paging = queryPaging(query);
										if (page !== undefined && paging === null) {
											return fail(
												`Query '${name}' cannot be paged; only rows and grouped aggregates support paging`,
											);
										}
										if (
											page?.limit !== undefined &&
											paging !== null &&
											(!Number.isInteger(page.limit) ||
												page.limit <= 0 ||
												page.limit > paging.maxLimit)
										) {
											return fail(
												`Page limit for '${name}' must be an integer from 1 to ${paging.maxLimit}`,
											);
										}
										const { maxLimit: _, ...limits } = pagination;
										const paged = {
											...limits,
											limit: page?.limit ?? pagination["limit"],
											...(page?.after === undefined ? {} : { after: page.after }),
										};
										return Result.succeed([
											name,
											{
												...bound,
												output:
													output["type"] === "rows" ? { ...output, pagination: paged } : paged,
											},
										] as const);
									},
								),
							);
						}),
					),
					(queries) =>
						Result.map(decodeDocument({ queries: Object.fromEntries(queries) }), (bound) => ({
							document: bound,
							arguments: boundArguments,
						})),
				);
			},
		),
	);

const sampleValue = (property: AppPropertyDefinition): unknown => {
	switch (property.type) {
		case "date":
			return "2026-01-01";
		case "enum":
			return property.choices.kind === "static"
				? (property.choices.values[0]?.value ?? "parameter")
				: "parameter";
		case "array":
			return [sampleValue(property.items)];
		case "string":
			return "UTC";
		case "number":
		case "integer":
			return 1;
		case "object":
			throw new Error("Object parameters are not supported");
		case "boolean":
			return true;
		case "datetime":
			return "2026-01-01T00:00:00.000Z";
		case "enum-array":
			return property.choices.kind === "static"
				? [property.choices.values[0]?.value ?? "parameter"]
				: ["parameter"];
		default:
			return property satisfies never;
	}
};

export type StoredValidationContext = BindingContext & {
	readonly maximumBranches: number;
	readonly sourceEntity: (parameter: string, alias: string) => Result.Result<TableReference, Error>;
};

export const storedValidationContext = (
	sourceEntity: StoredValidationContext["sourceEntity"] = (_, alias) =>
		Result.succeed({ alias, table: "sourceEntity:validation" }),
): StoredValidationContext => ({
	sourceEntity,
	now: new Date(0),
	maximumBranches: 256,
	reportingTimeZone: "UTC",
});

const choicePrefix = "choice:";
const setPrefix = "set:";
const choiceKey = (parameter: unknown) => `${choicePrefix}${String(parameter)}`;
const setKey = (parameter: unknown) => `${setPrefix}${String(parameter)}`;

export const authoredValidationBranches = (
	document: Authored.RyotQLDocument,
	context: StoredValidationContext,
): Result.Result<readonly RyotQLDocument[], Error> => {
	type Selections = Readonly<Record<string, string>>;
	const decisions = (
		value: unknown,
		selections: Selections,
	): Result.Result<readonly Selections[], Error> => {
		if (
			(!isObjectRecord(value) && !isUnknownArray(value)) ||
			(isObjectRecord(value) && value["type"] === "literal")
		) {
			return Result.succeed([selections]);
		}
		if (isObjectRecord(value)) {
			if (value["type"] === "choice" && isObjectRecord(value["cases"])) {
				const key = choiceKey(value["parameter"]);
				const selected = selections[key];
				if (selected !== undefined) {
					return decisions(value["cases"][selected], selections);
				}
				const branches: Selections[] = [];
				for (const [selection, branch] of Object.entries(value["cases"])) {
					const result = decisions(branch, { ...selections, [key]: selection });
					if (Result.isFailure(result)) {
						return result;
					}
					if (branches.length + result.success.length > context.maximumBranches) {
						return fail("Stored query exceeds the validation branch budget");
					}
					branches.push(...result.success);
				}
				return Result.succeed(branches);
			}
			if (value["type"] === "whenSet") {
				const key = setKey(value["parameter"]);
				const selected = selections[key];
				if (selected !== undefined) {
					return selected === "yes"
						? decisions(value["predicate"], selections)
						: Result.succeed([selections]);
				}
				const present = decisions(value["predicate"], { ...selections, [key]: "yes" });
				if (Result.isFailure(present)) {
					return present;
				}
				if (present.success.length >= context.maximumBranches) {
					return fail("Stored query exceeds the validation branch budget");
				}
				return Result.succeed([...present.success, { ...selections, [key]: "no" }]);
			}
		}
		let branches: readonly Selections[] = [selections];
		for (const child of Object.values(value)) {
			const next: Selections[] = [];
			for (const branch of branches) {
				const result = decisions(child, branch);
				if (Result.isFailure(result)) {
					return result;
				}
				if (next.length + result.success.length > context.maximumBranches) {
					return fail("Stored query exceeds the validation branch budget");
				}
				next.push(...result.success);
			}
			branches = next;
		}
		return Result.succeed(branches);
	};
	const branchArguments = (
		samples: Readonly<Record<string, unknown>>,
		selections: Selections,
	): Readonly<Record<string, unknown>> => {
		const bound = { ...samples };
		for (const [name, selection] of Object.entries(selections)) {
			if (name.startsWith(choicePrefix)) {
				bound[name.slice(choicePrefix.length)] = selection;
			} else if (selection === "no") {
				delete bound[name.slice(setPrefix.length)];
			}
		}
		return bound;
	};

	return Result.flatMap(validateAuthoredDocument(document), () => {
		if (!Number.isSafeInteger(context.maximumBranches) || context.maximumBranches <= 0) {
			return fail("A positive validation branch budget is required");
		}
		const fields = document.parameters?.fields ?? {};
		const samples = Object.fromEntries(
			Object.entries(fields).map(([name, property]) => [name, sampleValue(property)]),
		);
		const branchContext: BindingContext = {
			...context,
			resolveSourceEntity: (_, alias, parameter) => context.sourceEntity(parameter, alias),
		};
		return Result.flatMap(decisions(document.queries, {}), (branches) =>
			Result.all(
				branches.map((branch) =>
					Result.flatMap(
						materialize(
							document.queries,
							"queries",
							branchArguments(samples, branch),
							branchContext,
							undefined,
							undefined,
							fields,
						),
						(queries) => {
							if (!isObjectRecord(queries)) {
								return fail("Invalid query branches");
							}
							const stripped = Object.fromEntries(
								Object.entries(queries).map(([name, query]) => {
									if (!isObjectRecord(query) || !isObjectRecord(query["output"])) {
										return [name, query];
									}
									const output = query["output"];
									if (output["type"] === "rows" && isObjectRecord(output["pagination"])) {
										const { maxLimit: _, ...pagination } = output["pagination"];
										return [name, { ...query, output: { ...output, pagination } }];
									}
									const { maxLimit: _, ...aggregate } = output;
									return [name, { ...query, output: aggregate }];
								}),
							);
							return decodeDocument({ queries: stripped });
						},
					),
				),
			),
		);
	});
};

export const cursorBindingKey = (input: {
	readonly ownerIdentity: string;
	readonly sourceIdentity: string;
	readonly sort?: ExecutionRequest["sort"];
	readonly filter?: ExecutionRequest["filter"];
	readonly arguments: Readonly<Record<string, unknown>>;
}): string =>
	stableStringify({
		sort: input.sort ?? null,
		arguments: input.arguments,
		filter: input.filter ?? null,
		ownerIdentity: input.ownerIdentity,
		sourceIdentity: input.sourceIdentity,
	});
