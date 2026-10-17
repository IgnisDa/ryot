import type {
	AggregateOutput,
	FieldSelection,
	Include,
	NamedQuery,
	RyotQLDocument,
	RowsOutput,
	TimeSeriesOutput,
} from "@ryot-app/contract/modules/ryotql/language";

import {
	expandCatalogSelections,
	getCatalogTable,
	type CatalogTable,
	type RyotQLAccess,
} from "./catalog";

type AliasScope = ReadonlyMap<string, CatalogTable>;
type QuerySet = Pick<NamedQuery, "from" | "joins"> | Pick<Include, "from" | "joins">;

const isNonEmpty = <A>(values: readonly A[] | undefined): values is readonly [A, ...A[]] =>
	values !== undefined && values.length > 0;

export type NormalizedInclude = Omit<Include, "fields" | "include"> & {
	readonly fields: readonly FieldSelection[];
	readonly include?: readonly [NormalizedInclude, ...NormalizedInclude[]] | undefined;
};
export type NormalizedRowsOutput = Omit<RowsOutput, "fields" | "include"> & {
	readonly fields: readonly FieldSelection[];
	readonly include?: readonly [NormalizedInclude, ...NormalizedInclude[]] | undefined;
};
export type NormalizedNamedQuery = Omit<NamedQuery, "output"> & {
	readonly output: NormalizedRowsOutput | AggregateOutput | TimeSeriesOutput;
};
export type NormalizedRyotQLDocument = {
	readonly queries: Readonly<Record<string, NormalizedNamedQuery>>;
};

const buildScope = (query: QuerySet, ancestors: AliasScope) => {
	const scope = new Map(ancestors);
	for (const reference of [query.from, ...(query.joins ?? []).map((join) => join.table)]) {
		const table = getCatalogTable(reference.table);
		if (!table) {
			throw new Error(`RyotQL normalizer received unknown table '${reference.table}'`);
		}
		scope.set(reference.alias, table);
	}
	return scope;
};

const expandFields = (
	fields: Include["fields"],
	scope: AliasScope,
	access: RyotQLAccess,
): readonly FieldSelection[] => {
	const expanded = expandCatalogSelections(fields, (alias) => scope.get(alias), access);
	if (expanded.error) {
		throw new Error(`RyotQL normalizer received ${expanded.error}`);
	}
	return expanded.fields;
};

const normalizeInclude = (
	include: Include,
	ancestors: AliasScope,
	access: RyotQLAccess,
): NormalizedInclude => {
	const scope = buildScope(include, ancestors);
	const { fields, include: children, ...rest } = include;
	const nested = children?.map((child) => normalizeInclude(child, scope, access));
	return {
		...rest,
		fields: expandFields(fields, scope, access),
		...(isNonEmpty(nested) ? { include: nested } : {}),
	};
};

const normalizeNamedQuery = (query: NamedQuery, access: RyotQLAccess): NormalizedNamedQuery => {
	if (query.output.type === "aggregate") {
		return { ...query, output: query.output };
	}
	if (query.output.type === "timeSeries") {
		return { ...query, output: query.output };
	}
	const scope = buildScope(query, new Map());
	const { fields, include: children, ...restOutput } = query.output;
	const include = children?.map((entry) => normalizeInclude(entry, scope, access));
	return {
		...query,
		output: {
			...restOutput,
			fields: expandFields(fields, scope, access),
			...(isNonEmpty(include) ? { include } : {}),
		},
	};
};

export const normalizeRyotQLDocument = (
	document: RyotQLDocument,
	access: RyotQLAccess,
): NormalizedRyotQLDocument => ({
	queries: Object.fromEntries(
		Object.entries(document.queries).map(([name, query]) => [
			name,
			normalizeNamedQuery(query, access),
		]),
	),
});
