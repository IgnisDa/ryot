import { BROWSE_SUBJECT_ALIAS } from "@ryot-app/contract/modules/filters/browse";
import type { FilterField } from "@ryot-app/contract/modules/filters/schemas";
import {
	definitionOwner,
	ownerIdentityReference,
	type QueryOwnerReference,
} from "@ryot-app/contract/modules/plugins/references";
import type {
	Controls,
	NamedQuery,
	OrderBy,
	OutputControlField,
	Predicate,
	RyotQLDocument,
	ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/authored";
import { controlTargets, mapScalarExpression } from "@ryot-app/contract/modules/ryotql/authored";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	entitySchemaPredicate,
	literal,
	table,
} from "@ryot-app/ryotql";
import { nameSortTarget, reservedBrowseFieldKeys } from "@ryot-app/ryotql-recipes/browse";
import { collectionsFilterTarget } from "@ryot-app/ryotql-recipes/filters";
import { propertyFilterFields } from "@ryot-app/ryotql-recipes/property-filter-fields";
import {
	compileFilter,
	type FilterTarget,
	outputFilterTargets,
	queryAliases,
} from "@ryot-app/ryotql/filters";
import { compileSort, type SortTarget } from "@ryot-app/ryotql/sort";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { DateTime, Result } from "effect";

import { browseIssue } from "#modules/definitions/browse-validation";
import type { CatalogEntitySchema } from "#modules/definitions/catalog";

const fail = (message: string) => Result.fail(new Error(message));
export type MembershipSource = {
	readonly collectionId: string;
	readonly propertiesSchema: AppSchema;
};

export type ControlSchema = Pick<
	CatalogEntitySchema,
	"slug" | "browse" | "pluginId" | "packageId" | "pluginScope" | "isEffective"
>;
type Target = NonNullable<Controls["filter"]>;
type AtomicTarget = Exclude<Target, { kind: "composite" }>;
type ControlContext = {
	readonly memberships: readonly MembershipSource[];
	readonly arguments: Readonly<Record<string, unknown>>;
};

const membershipCollection = (
	query: NamedQuery,
	expression: ScalarExpression,
	context: ControlContext,
) => {
	let unwrapped = expression;
	while (unwrapped.type === "cast") {
		unwrapped = unwrapped.expr;
	}
	if (
		unwrapped.type !== "jsonPath" ||
		unwrapped.expr.type !== "column" ||
		unwrapped.expr.field !== "properties"
	) {
		return fail("Membership fields must project relationship properties");
	}
	const alias = unwrapped.expr.tableAlias;
	const binding = [
		query.from,
		...(query.joins ?? []).flatMap((join) => (join.type === "jsonElements" ? [] : [join.table])),
	].find((reference) => reference.alias === alias);
	if (!binding || !("table" in binding) || binding.table !== "relationship") {
		return fail("Membership controls require a relationship binding");
	}
	const ids = new Set<string>();
	const state = { kernel: false, member: false };
	const value = (node: ScalarExpression) => {
		if (node.type === "literal") {
			return node.value;
		}
		if (node.type === "parameter") {
			return context.arguments[node.name];
		}
		return undefined;
	};
	const equality = (candidate: ScalarExpression, other: ScalarExpression) => {
		if (candidate.type !== "column" || candidate.tableAlias !== alias) {
			return;
		}
		const selected = value(other);
		if (candidate.field === "targetEntityId" && typeof selected === "string") {
			ids.add(selected);
		}
		if (candidate.field === "relationshipSchemaSlug" && selected === "member-of") {
			state.member = true;
		}
	};
	const visit = (predicate: Predicate): void => {
		if (predicate.type === "and") {
			for (const child of predicate.predicates) {
				visit(child);
			}
		}
		if (predicate.type === "comparison" && predicate.operator === "eq") {
			equality(predicate.left, predicate.right);
			equality(predicate.right, predicate.left);
		}
		if (
			predicate.type === "isNull" &&
			predicate.expr.type === "column" &&
			predicate.expr.tableAlias === alias &&
			predicate.expr.field === "relationshipSchemaPluginId"
		) {
			state.kernel = true;
		}
	};
	if (query.where !== undefined) {
		visit(query.where);
	}
	for (const join of query.joins ?? []) {
		if (join.type !== "jsonElements") {
			visit(join.on);
		}
	}
	const [id] = ids;
	const source = context.memberships.find(({ collectionId }) => collectionId === id);
	return state.member && state.kernel && ids.size === 1 && source !== undefined
		? Result.succeed({ source, path: unwrapped.path })
		: fail("Membership projection must bind the authorized collection independently");
};

export type ResolvedControls = {
	readonly sorts: readonly SortTarget[];
	readonly filters: readonly FilterTarget[];
	readonly subject: undefined | { readonly entityAlias: string };
};

const resolveBrowse = (
	target: Extract<AtomicTarget, { kind: "browse" }>,
	query: NamedQuery,
	schemas: readonly ControlSchema[],
) => {
	const aliases = queryAliases(query);
	const reference = [
		query.from,
		...(query.joins ?? []).flatMap((join) => (join.type === "jsonElements" ? [] : [join.table])),
	].find(({ alias }) => alias === target.alias);
	if (!reference || !("table" in reference) || reference.table !== "entity") {
		return fail(`Browse control alias '${target.alias}' must be an entity table`);
	}
	const selected: ControlSchema[] = [];
	for (const requested of target.schemas) {
		const schema = schemas.find((entry) => {
			if (!entry.isEffective || entry.slug !== requested.slug) {
				return false;
			}
			switch (requested.owner.kind) {
				case "self":
					return false;
				case "local":
					return entry.pluginId === requested.owner.pluginId;
				case "kernel":
					return entry.pluginId === null;
				case "package":
					return (
						entry.packageId === requested.owner.packageId &&
						entry.pluginScope === requested.owner.scope
					);
				default:
					return requested.owner satisfies never;
			}
		});
		if (!schema || selected.includes(schema)) {
			return fail(`Browse schema '${requested.slug}' is unavailable or duplicated`);
		}
		if (schema.browse !== null) {
			const issue = browseIssue(schema.browse);
			if (issue !== undefined) {
				return fail(issue);
			}
		}
		selected.push(schema);
	}
	const entity = table("entity", target.alias);
	const filters = new Map<string, FilterTarget>();
	const sorts = new Map<string, SortTarget>();

	for (const [index, schema] of selected.entries()) {
		const when = entitySchemaPredicate(
			entity,
			schema.slug,
			ownerIdentityReference(definitionOwner(schema.pluginId)),
		);
		for (const field of schema.browse?.fields ?? []) {
			if (reservedBrowseFieldKeys.includes(field.key)) {
				return fail(`Browse key '${field.key}' is reserved`);
			}
			const collisions = selected.some(
				(other) =>
					other.pluginId !== schema.pluginId &&
					other.browse?.fields.some((candidate) => candidate.key === field.key),
			);
			const key = collisions ? `${field.key}:${schema.pluginId ?? "kernel"}` : field.key;
			const names = new Map<string, string>();
			const value =
				field.kind === "value" || field.kind === "sort"
					? mapScalarExpression(field.expression, {
							alias: (alias) => {
								if (alias === BROWSE_SUBJECT_ALIAS) {
									return target.alias;
								}
								let renamed = names.get(alias);
								if (renamed === undefined) {
									renamed = `control${index}_${alias}`;
									while (aliases.includes(renamed)) {
										renamed = `_${renamed}`;
									}
									names.set(alias, renamed);
								}
								return renamed;
							},
						})
					: undefined;
			if ((field.kind === "value" || field.kind === "sort") && field.sort && value) {
				const previous = sorts.get(key);
				const branch = { when, value };
				sorts.set(key, {
					...field.sort,
					key,
					branches: previous ? [...previous.branches, branch] : [branch],
				});
			}
			if (field.kind === "sort") {
				continue;
			}
			const previous = filters.get(key);
			if (field.kind === "value" && value) {
				const { sort: __, expression: _, ...spec } = field;
				const branch = { when, value };
				filters.set(key, {
					spec: { ...spec, key },
					branches: previous ? [...previous.branches, branch] : [branch],
				});
			} else if (field.kind === "relationship" || field.kind === "session-event") {
				const spec =
					field.kind === "relationship"
						? {
								...field,
								key,
								relationship: {
									...field.relationship,
									owner: ownerIdentityReference(field.relationship.owner),
								},
							}
						: {
								...field,
								key,
								event: { ...field.event, owner: ownerIdentityReference(field.event.owner) },
							};
				const branch = { when, link: spec };
				filters.set(key, { spec, branches: previous ? [...previous.branches, branch] : [branch] });
			}
		}
	}
	return Result.succeed({
		sorts: [...sorts.values()],
		filters: [...filters.values()],
		subject: { entityAlias: target.alias },
	});
};

const bindings = (source: NamedQuery) =>
	new Map<string, unknown>([
		[source.from.alias, source.from] as const,
		...(source.joins ?? []).map((join) =>
			join.type === "jsonElements"
				? ([join.alias, { expr: join.expr, type: join.type }] as const)
				: ([join.table.alias, join.table] as const),
		),
	]);

const resolveAtomicControl = (
	target: undefined | AtomicTarget,
	query: NamedQuery,
	schemas: readonly ControlSchema[],
	document?: RyotQLDocument,
	context?: ControlContext,
): Result.Result<ResolvedControls, Error> => {
	if (target === undefined) {
		return Result.succeed({ sorts: [], filters: [], subject: undefined });
	}
	if (target.kind === "browse") {
		return resolveBrowse(target, query, schemas);
	}
	const projection = target.query === undefined ? query : document?.queries[target.query];
	if (projection?.output.type !== "rows") {
		return fail("Output controls require a named rows projection");
	}

	const current = bindings(query);
	for (const [alias, reference] of bindings(projection)) {
		if (stableStringify(current.get(alias)) !== stableStringify(reference)) {
			return fail(`Control projection alias '${alias}' has incompatible table bindings`);
		}
	}
	const fields: OutputControlField[] = [];
	for (const field of target.fields) {
		if (!field.key.startsWith("membership.") || context === undefined) {
			fields.push(field);
			continue;
		}
		const selected = projection.output.fields.find(
			(selection) => "key" in selection && selection.key === field.field,
		);
		if (!selected || !("expr" in selected)) {
			return fail("Membership field is not projected");
		}
		const authority = membershipCollection(projection, selected.expr, context);
		if (Result.isFailure(authority)) {
			return Result.fail(authority.failure);
		}
		const property = field.key.slice("membership.".length);
		if (authority.success.path.length !== 1 || authority.success.path[0] !== property) {
			return fail("Membership field must match its stored property");
		}
		const schema = authority.success.source.propertiesSchema;
		const resolved = propertyFilterFields(schema, [{ property, field: field.field }]);
		if (Result.isFailure(resolved)) {
			return Result.fail(resolved.failure);
		}
		const [authoritative] = resolved.success;
		if (!authoritative || authoritative.type !== field.type) {
			return fail(`Membership field '${property}' differs from its stored schema`);
		}
		fields.push({
			...authoritative,
			key: field.key,
			...(field.sort === undefined ? {} : { sort: field.sort }),
		});
	}
	for (const field of fields) {
		if (field.sort !== undefined && (field.type === "text-list" || field.type === "enum-list")) {
			return fail(`Field '${field.key}' cannot be sorted`);
		}
	}
	const metadata = new Map(
		fields.flatMap((field) => (field.sort === undefined ? [] : [[field.key, field.sort] as const])),
	);
	return Result.map(
		outputFilterTargets(
			{ ...projection, output: projection.output },
			fields.map(({ sort: _, ...field }) => field),
		),
		(filters) => ({
			filters,
			subject: undefined,
			sorts: filters.flatMap(({ spec, branches }): SortTarget[] => {
				const [branch] = branches;
				if (
					spec.kind !== "value" ||
					spec.type === "text-list" ||
					spec.type === "enum-list" ||
					branch.value === undefined
				) {
					return [];
				}
				let value = castText(branch.value);
				if (spec.type === "number" || spec.type === "rating") {
					value = castNumber(branch.value);
				}
				if (spec.type === "boolean") {
					value = castBoolean(branch.value);
				}
				if (spec.type === "date") {
					value = castDate(branch.value);
				}
				return [
					{
						...(metadata.get(spec.key) ?? {
							label: spec.label,
							ascending: "Ascending",
							descending: "Descending",
							defaultDirection: "asc" as const,
						}),
						key: spec.key,
						branches: [{ value }],
					},
				];
			}),
		}),
	);
};

export const resolveControl = (
	target: Target | undefined,
	query: NamedQuery,
	schemas: readonly ControlSchema[],
	document?: RyotQLDocument,
	context?: ControlContext,
): Result.Result<ResolvedControls, Error> => {
	const targets = target === undefined ? [] : controlTargets(target);
	const filters: FilterTarget[] = [];
	const sorts: SortTarget[] = [];
	let subject: ResolvedControls["subject"];
	for (const part of targets) {
		const resolved = resolveAtomicControl(part, query, schemas, document, context);
		if (Result.isFailure(resolved)) {
			return Result.fail(resolved.failure);
		}
		if (resolved.success.subject !== undefined) {
			if (subject !== undefined && subject.entityAlias !== resolved.success.subject.entityAlias) {
				return fail("Composite controls have ambiguous subjects");
			}
			subject = resolved.success.subject;
		}
		filters.push(...resolved.success.filters);
		sorts.push(...resolved.success.sorts);
	}
	if (subject !== undefined) {
		filters.unshift(collectionsFilterTarget);
		sorts.unshift(nameSortTarget(table("entity", subject.entityAlias)));
	}
	if (new Set(filters.map(({ spec }) => spec.key)).size !== filters.length) {
		return fail("Control filter keys must be unique");
	}
	if (
		new Set(sorts.flatMap(({ key }) => [`${key}-asc`, `${key}-desc`])).size !==
		sorts.length * 2
	) {
		return fail("Control sort IDs must be unique");
	}
	return Result.succeed({ sorts, filters, subject });
};

const describeOwner = (owner: QueryOwnerReference) => {
	if (owner.kind === "kernel") {
		return Result.succeed(definitionOwner(null));
	}
	if (owner.kind === "local") {
		return Result.succeed(definitionOwner(owner.pluginId));
	}
	return fail("Control metadata contains an unresolved owner");
};

export const describeFilterFields = (
	controls: ResolvedControls,
): Result.Result<readonly FilterField[], Error> =>
	Result.all(
		controls.filters.map(({ spec }) => {
			if (spec.kind === "value") {
				return Result.succeed({ ...spec, field: spec.key });
			}
			if (spec.kind === "relationship") {
				return Result.map(describeOwner(spec.relationship.owner), (owner) => ({
					...spec,
					relationship: { ...spec.relationship, owner },
				}));
			}
			return Result.map(describeOwner(spec.event.owner), (owner) => ({
				...spec,
				event: { ...spec.event, owner },
			}));
		}),
	);

export const compileControlFilter = (
	controls: ResolvedControls,
	query: NamedQuery,
	filter: Parameters<typeof compileFilter>[0]["filter"],
	now: Date,
) =>
	compileFilter({
		filter,
		source: query,
		targets: controls.filters,
		subject: controls.subject,
		now: DateTime.makeUnsafe(now),
	});

export const compileControlSort = (
	controls: ResolvedControls,
	choice: string,
): Result.Result<readonly OrderBy[], Error> =>
	compileSort(
		controls.sorts,
		choice,
		controls.subject === undefined
			? literal(null)
			: column(table("entity", controls.subject.entityAlias), "id"),
	);

export const hasMembershipControls = (document: RyotQLDocument) =>
	Object.values(document.controls ?? {}).some(
		(target) =>
			target !== undefined &&
			controlTargets(target).some(
				(part) =>
					part.kind === "outputs" && part.fields.some(({ key }) => key.startsWith("membership.")),
			),
	);
