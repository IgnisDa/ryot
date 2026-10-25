import type {
	AggregationSpec,
	CorrelatedQuerySet,
	Include,
	NamedQuery,
	Predicate,
	ScalarExpression,
	TableReference,
} from "@ryot-app/contract/modules/ryotql/language";
import { stableStringify } from "@ryot-app/ts-utils/json";

import {
	type CatalogTable,
	getCatalogTable,
	jsonElementsTable,
	resolveCatalogField,
	type RyotQLExecutionScope,
} from "./catalog";
import { type KindResolver, scalarExpressionKind } from "./expression-kind";
import type { ExpandedInclude, ExpandedNamedQuery } from "./validator";

export type QuerySet = Include | CorrelatedQuerySet | Pick<NamedQuery, "from" | "joins" | "where">;

export type PlannedTable = {
	readonly sqlAlias: string;
	readonly table: CatalogTable;
	readonly joinedNullable: boolean;
	readonly fields: ReadonlySet<string>;
};

export type AliasScope = {
	readonly parent: undefined | AliasScope;
	readonly execution: RyotQLExecutionScope;
	readonly tables: ReadonlyMap<string, { readonly table: CatalogTable }>;
};

export type HoistedSource = {
	readonly name: string;
	readonly local: readonly Predicate[];
	readonly keys: ReadonlyMap<string, { readonly column: string; readonly expr: ScalarExpression }>;
};

export type AggregateGroup = {
	readonly alias: string;
	readonly scope: PlannedScope;
	readonly query: CorrelatedQuerySet;
	readonly measures: ReadonlyMap<
		string,
		{ readonly alias: string; readonly aggregation: AggregationSpec }
	>;
};

export type PlannedScope = {
	readonly id: number;
	readonly execution: RyotQLExecutionScope;
	readonly parent: undefined | PlannedScope;
	readonly materializedRoot: string | undefined;
	readonly tables: ReadonlyMap<string, PlannedTable>;
	readonly children: ReadonlyMap<string, PlannedScope>;
	readonly groups: ReadonlyMap<string, AggregateGroup>;
	readonly hoisted: ReadonlyMap<string, HoistedSource>;
};

type Node = Predicate | ScalarExpression;

type Correlated = { readonly extras: readonly Node[]; readonly query: CorrelatedQuerySet };

type Operands = {
	readonly row: readonly Node[];
	readonly correlated?: Correlated;
	readonly element: readonly Node[];
	readonly aggregate?: AggregationSpec;
};

const aggregationNodes = (aggregation: AggregationSpec): Node[] =>
	aggregation.function === "count" ? [] : [aggregation.expr];

const operands = (node: Node): Operands => {
	switch (node.type) {
		case "in":
			return { element: [], row: [node.expr, ...node.values] };
		case "or":
		case "and":
			return { element: [], row: node.predicates };
		case "not":
			return { element: [], row: [node.predicate] };
		case "cast":
		case "floor":
		case "round":
		case "isNull":
		case "integer":
		case "jsonPath":
		case "isNotNull":
		case "localDate":
		case "localHour":
		case "transform":
		case "dateBucket":
			return { element: [], row: [node.expr] };
		case "first":
			return {
				row: [],
				element: [],
				correlated: {
					query: node.query,
					extras: [node.select, ...node.orderBy.map((order) => order.expr)],
				},
			};
		case "column":
		case "literal":
		case "pluginId":
		case "currentDate":
		case "jsonElement":
			return { row: [], element: [] };
		case "exists":
			return { row: [], element: [], correlated: { extras: [], query: node.query } };
		case "concat":
		case "coalesce":
			return { element: [], row: node.values };
		case "contains":
		case "arithmetic":
		case "comparison":
		case "startsWith":
			return { element: [], row: [node.left, node.right] };
		case "aggregate":
			return {
				row: [],
				element: [],
				aggregate: node.aggregation,
				correlated: { query: node.query, extras: aggregationNodes(node.aggregation) },
			};
		case "jsonCount":
		case "jsonExists":
			return { row: [node.array], element: node.where ? [node.where] : [] };
		case "jsonFirst":
			return {
				row: [node.array],
				element: [
					node.select,
					...(node.where ? [node.where] : []),
					...node.orderBy.map((order) => order.expr),
				],
			};
		case "conditional":
			return { element: [], row: [node.condition, node.whenTrue, node.whenFalse] };
		default:
			throw new Error(String(node satisfies never));
	}
};

const querySetNodes = (query: QuerySet): Node[] => [
	...(query.where ? [query.where] : []),
	...(query.joins ?? []).map((join) => (join.type === "jsonElements" ? join.expr : join.on)),
];

const includeNodes = (include: ExpandedInclude): Node[] => [
	...querySetNodes(include),
	...include.fields.map((field) => field.expr),
	...include.orderBy.map((order) => order.expr),
	...(include.include ?? []).flatMap(includeNodes),
];

const collectColumns = (node: Node, columns: Map<string, Set<string>>): void => {
	if (node.type === "column") {
		const fields = columns.get(node.tableAlias) ?? new Set<string>();
		fields.add(node.field);
		columns.set(node.tableAlias, fields);
		return;
	}
	const { row, element, correlated } = operands(node);
	for (const child of [
		...row,
		...element,
		...(correlated ? [...querySetNodes(correlated.query), ...correlated.extras] : []),
	]) {
		collectColumns(child, columns);
	}
};

const requireTable = (name: string) => {
	const table = getCatalogTable(name);
	if (!table) {
		throw new Error(`RyotQL planner received unknown table '${name}'`);
	}
	return table;
};

const queryTables = (query: QuerySet) => [
	{ joinedNullable: false, alias: query.from.alias, table: requireTable(query.from.table) },
	...(query.joins ?? []).map((join) =>
		join.type === "jsonElements"
			? { alias: join.alias, table: jsonElementsTable, joinedNullable: join.mode === "left" }
			: {
					alias: join.table.alias,
					joinedNullable: join.type === "left",
					table: requireTable(join.table.table),
				},
	),
];

type ScopeChain<Table> = {
	readonly tables: ReadonlyMap<string, Table>;
	readonly parent: undefined | ScopeChain<Table>;
};

export const lookupTable = <Table>(scope: ScopeChain<Table>, alias: string): Table => {
	let current: undefined | ScopeChain<Table> = scope;
	while (current) {
		const table = current.tables.get(alias);
		if (table) {
			return table;
		}
		current = current.parent;
	}
	throw new Error(`RyotQL compiler received unknown alias '${alias}'`);
};

export const correlatedAliasScope = (
	query: CorrelatedQuerySet,
	parent: AliasScope,
): AliasScope => ({
	parent,
	execution: parent.execution,
	tables: new Map(queryTables(query).map(({ alias, table }) => [alias, { table }])),
});

export const kindResolver: KindResolver<AliasScope> = {
	correlated: correlatedAliasScope,
	column: (expr, scope) =>
		resolveCatalogField(lookupTable(scope, expr.tableAlias).table, expr.field, scope.execution)
			?.kind,
};

export const conjuncts = (predicate: Predicate): Predicate[] =>
	predicate.type === "and" ? predicate.predicates.flatMap(conjuncts) : [predicate];

const localExpression = (expr: ScalarExpression, alias: string | undefined): boolean => {
	if (expr.type === "literal" || expr.type === "pluginId" || expr.type === "currentDate") {
		return true;
	}
	if (expr.type === "cast" || expr.type === "jsonPath") {
		return localExpression(expr.expr, alias);
	}
	return expr.type === "column" && expr.tableAlias === alias;
};

const localPredicate = (predicate: Predicate, alias: string): boolean => {
	if (predicate.type === "and" || predicate.type === "or") {
		return predicate.predicates.every((value) => localPredicate(value, alias));
	}
	if (predicate.type === "not") {
		return localPredicate(predicate.predicate, alias);
	}
	if (predicate.type === "isNull" || predicate.type === "isNotNull") {
		return localExpression(predicate.expr, alias);
	}
	if (predicate.type === "in") {
		return [predicate.expr, ...predicate.values].every((value) => localExpression(value, alias));
	}
	return (
		(predicate.type === "comparison" ||
			predicate.type === "contains" ||
			predicate.type === "startsWith") &&
		localExpression(predicate.left, alias) &&
		localExpression(predicate.right, alias)
	);
};

const referencesAlias = (node: Node, alias: string): boolean => {
	const columns = new Map<string, Set<string>>();
	collectColumns(node, columns);
	return columns.has(alias);
};

const hasClosedDateRange = (local: readonly Predicate[], scope: AliasScope) => {
	const bounds = new Map<string, { lower: boolean; upper: boolean }>();
	for (const predicate of local) {
		if (
			predicate.type !== "comparison" ||
			predicate.operator === "eq" ||
			predicate.operator === "neq"
		) {
			continue;
		}
		for (const { value, bound, reversed } of [
			{ reversed: false, value: predicate.left, bound: predicate.right },
			{ reversed: true, bound: predicate.left, value: predicate.right },
		]) {
			if (
				!localExpression(value, undefined) &&
				localExpression(bound, undefined) &&
				scalarExpressionKind(value, scope, kindResolver) === "date" &&
				scalarExpressionKind(bound, scope, kindResolver) === "date"
			) {
				const key = stableStringify(value);
				const current = bounds.get(key) ?? { lower: false, upper: false };
				const lower = (predicate.operator === "gt" || predicate.operator === "gte") !== reversed;
				bounds.set(key, { lower: current.lower || lower, upper: current.upper || !lower });
			}
		}
	}
	return [...bounds.values()].some((bound) => bound.lower && bound.upper);
};

export const jsonKeyColumn = (expr: ScalarExpression) =>
	expr.type === "cast" &&
	expr.target !== "json" &&
	expr.expr.type === "jsonPath" &&
	expr.expr.expr.type === "column"
		? expr.expr.expr
		: undefined;

const jsonKeys = (expr: ScalarExpression): ScalarExpression[] => {
	if (expr.type === "coalesce") {
		return expr.values.flatMap(jsonKeys);
	}
	return jsonKeyColumn(expr) ? [expr] : [];
};

const joinKeys = (
	query: CorrelatedQuerySet,
	alias: string,
	references: readonly TableReference[],
): ScalarExpression[] => {
	const keys = new Map<string, ScalarExpression>();
	for (const join of query.joins ?? []) {
		if (join.type === "jsonElements") {
			continue;
		}
		for (const predicate of conjuncts(join.on)) {
			if (predicate.type !== "comparison" || predicate.operator !== "eq") {
				continue;
			}
			for (const [operand, other] of [
				[predicate.left, predicate.right],
				[predicate.right, predicate.left],
			] as const) {
				const otherReference = references.some(
					(reference) =>
						reference.alias !== alias &&
						!localExpression(other, undefined) &&
						localExpression(other, reference.alias),
				);
				if (!otherReference) {
					continue;
				}
				for (const key of jsonKeys(operand)) {
					if (jsonKeyColumn(key)?.tableAlias === alias) {
						keys.set(stableStringify(key), key);
					}
				}
			}
		}
	}
	return [...keys.values()];
};

// A fused aggregate runs once per outer row. A reference whose filter or JSON join keys do not
// depend on the outer row is evaluated once instead: a closed date range is selective enough to
// scan once, and precomputed keys avoid re-extracting JSON for every outer row.
const hoistSources = (
	query: CorrelatedQuerySet,
	scope: AliasScope,
	id: number,
): ReadonlyMap<string, HoistedSource> => {
	const hoisted = new Map<string, HoistedSource>();
	const joins = query.joins ?? [];
	if (joins.some((join) => join.type !== "inner")) {
		return hoisted;
	}
	const references = [
		query.from,
		...joins.flatMap((join) => (join.type === "inner" ? [join.table] : [])),
	];
	const predicates = [
		...(query.where ? conjuncts(query.where) : []),
		...joins.flatMap((join) => (join.type === "inner" ? conjuncts(join.on) : [])),
	];
	for (const [index, reference] of references.entries()) {
		const local = predicates.filter(
			(predicate) =>
				localPredicate(predicate, reference.alias) && referencesAlias(predicate, reference.alias),
		);
		const keys = joinKeys(query, reference.alias, references);
		const independent = predicates.every((predicate) => {
			if (!referencesAlias(predicate, reference.alias)) {
				return true;
			}
			const columns = new Map<string, Set<string>>();
			collectColumns(predicate, columns);
			return [...columns.keys()].every((alias) => !isAncestorAlias(scope.parent, alias));
		});
		if (hasClosedDateRange(local, scope) || (keys.length > 0 && independent)) {
			hoisted.set(reference.alias, {
				local,
				name: `hoisted${id}_${index}`,
				keys: new Map(
					keys.map((expr, key) => [stableStringify(expr), { expr, column: `hoisted_key_${key}` }]),
				),
			});
		}
	}
	return hoisted;
};

const isAncestorAlias = (scope: undefined | AliasScope, alias: string): boolean => {
	let current = scope;
	while (current) {
		if (current.tables.has(alias)) {
			return true;
		}
		current = current.parent;
	}
	return false;
};

type Planner = { nextId: number };

type ScopeInput = {
	readonly include?: true;
	readonly query: QuerySet;
	readonly nodes: readonly Node[];
	readonly includes: readonly ExpandedInclude[];
};

const planScope = (
	planner: Planner,
	input: ScopeInput,
	parent: undefined | PlannedScope,
	execution: RyotQLExecutionScope,
	hoist: boolean,
): PlannedScope => {
	const id = planner.nextId++;
	const prefix = parent === undefined ? "" : `s${id}_`;
	const columns = new Map<string, Set<string>>();
	for (const node of [
		...querySetNodes(input.query),
		...input.nodes,
		...input.includes.flatMap(includeNodes),
	]) {
		collectColumns(node, columns);
	}
	const tables = new Map(
		queryTables(input.query).map(({ alias, table, joinedNullable }, index) => [
			alias,
			{
				table,
				joinedNullable,
				sqlAlias: `${prefix}t${index}`,
				fields: columns.get(alias) ?? new Set<string>(),
			},
		]),
	);
	const aliasScope: AliasScope = { parent, tables, execution };
	const correlated = new Map<string, { extras: Node[]; query: CorrelatedQuerySet }>();
	const fused = new Map<
		string,
		{ query: CorrelatedQuerySet; measures: Map<string, AggregationSpec> }
	>();
	const visit = (node: Node, fusable: boolean): void => {
		const { row, element, aggregate, correlated: query } = operands(node);
		row.forEach((child) => visit(child, fusable));
		element.forEach((child) => visit(child, false));
		if (!query) {
			return;
		}
		const key = stableStringify(query.query);
		if (aggregate && fusable) {
			const group = fused.get(key) ?? { query: query.query, measures: new Map() };
			group.measures.set(stableStringify(aggregate), aggregate);
			fused.set(key, group);
			return;
		}
		const child = correlated.get(key) ?? { extras: [], query: query.query };
		child.extras.push(...query.extras);
		correlated.set(key, child);
	};
	if (input.query.where) {
		visit(input.query.where, true);
	}
	for (const join of input.query.joins ?? []) {
		visit(join.type === "jsonElements" ? join.expr : join.on, false);
	}
	input.nodes.forEach((node) => visit(node, true));
	const scope: { -readonly [Key in keyof PlannedScope]: PlannedScope[Key] } = {
		id,
		parent,
		tables,
		execution,
		groups: new Map(),
		children: new Map(),
		hoisted: hoist ? hoistSources(input.query, aliasScope, id) : new Map<string, HoistedSource>(),
		materializedRoot:
			input.include && tables.get(input.query.from.alias)?.table.materializedInIncludes
				? `include${id}`
				: undefined,
	};
	scope.children = new Map([
		...[...correlated].map(
			([key, child]) =>
				[
					key,
					planScope(
						planner,
						{ includes: [], query: child.query, nodes: child.extras },
						scope,
						execution,
						false,
					),
				] as const,
		),
		...input.includes.map(
			(include) =>
				[
					stableStringify(include),
					planScope(
						planner,
						{
							include: true,
							query: include,
							includes: include.include ?? [],
							nodes: [
								...include.fields.map((field) => field.expr),
								...include.orderBy.map((order) => order.expr),
							],
						},
						scope,
						execution,
						false,
					),
				] as const,
		),
	]);
	scope.groups = new Map(
		[...fused].map(([key, group], index) => [
			key,
			{
				query: group.query,
				alias: `aggregate${id}_${index}`,
				measures: new Map(
					[...group.measures].map(([measureKey, aggregation], measure) => [
						measureKey,
						{ aggregation, alias: `v${measure}` },
					]),
				),
				scope: planScope(
					planner,
					{
						includes: [],
						query: group.query,
						nodes: [...group.measures.values()].flatMap(aggregationNodes),
					},
					scope,
					execution,
					true,
				),
			},
		]),
	);
	return scope;
};

export const planQuery = (
	query: ExpandedNamedQuery,
	execution: RyotQLExecutionScope,
): PlannedScope => {
	const planner: Planner = { nextId: 0 };
	const output = query.output;
	if (output.type === "aggregate") {
		return planScope(
			planner,
			{
				query,
				includes: [],
				nodes: [
					...(output.groupBy ?? []).map((group) => group.expr),
					...output.measures.flatMap((measure) => aggregationNodes(measure.aggregation)),
				],
			},
			undefined,
			execution,
			false,
		);
	}
	return planScope(
		planner,
		{
			query,
			includes: output.include ?? [],
			nodes: [
				...output.fields.map((field) => field.expr),
				...output.orderBy.map((order) => order.expr),
			],
		},
		undefined,
		execution,
		false,
	);
};

export const childScope = (scope: PlannedScope, query: Include | CorrelatedQuerySet) => {
	const child = scope.children.get(stableStringify(query));
	if (!child) {
		throw new Error("RyotQL compiler received an unplanned correlated query");
	}
	return child;
};

export const planScopes = (scope: PlannedScope): PlannedScope[] => [
	scope,
	...[...scope.children.values()].flatMap(planScopes),
	...[...scope.groups.values()].flatMap((group) => planScopes(group.scope)),
];
