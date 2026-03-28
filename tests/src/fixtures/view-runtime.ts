import type { paths } from "@ryot/generated/openapi/app-backend";
import { type Client, createAuthenticatedClient } from "./auth";
import { createEntitySchema } from "./entity-schemas";
import { createTracker } from "./trackers";

type ExecuteViewRuntimeBody = NonNullable<
	paths["/view-runtime/execute"]["post"]["requestBody"]
>["content"]["application/json"];

type RuntimeRef =
	| { type: "entity-column"; slug: string; column: string }
	| { type: "schema-property"; slug: string; property: string }
	| { type: "computed-field"; key: string }
	| { type: "event-join-column"; joinKey: string; column: string }
	| { type: "event-join-property"; joinKey: string; property: string };

type ViewExpression =
	| { type: "literal"; value: unknown | null }
	| { type: "reference"; reference: RuntimeRef }
	| { type: "coalesce"; values: ViewExpression[] }
	| {
			type: "arithmetic";
			left: ViewExpression;
			right: ViewExpression;
			operator: "add" | "subtract" | "multiply" | "divide";
	  }
	| { type: "round"; expression: ViewExpression }
	| { type: "floor"; expression: ViewExpression }
	| { type: "integer"; expression: ViewExpression }
	| { type: "concat"; values: ViewExpression[] }
	| {
			type: "conditional";
			condition: unknown;
			whenTrue: ViewExpression;
			whenFalse: ViewExpression;
	  };

type ExpressionInput = ViewExpression | string[];

type RuntimeField = {
	key: string;
	expression: ViewExpression;
};

type ViewPredicate =
	| {
			type: "comparison";
			left: ViewExpression;
			right: ViewExpression;
			operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
	  }
	| { type: "in"; expression: ViewExpression; values: ViewExpression[] }
	| { type: "contains"; expression: ViewExpression; value: ViewExpression }
	| { type: "isNull"; expression: ViewExpression }
	| { type: "isNotNull"; expression: ViewExpression }
	| { type: "and"; predicates: ViewPredicate[] }
	| { type: "or"; predicates: ViewPredicate[] }
	| { type: "not"; predicate: ViewPredicate };

type LegacyFilter = {
	op:
		| "eq"
		| "neq"
		| "gt"
		| "gte"
		| "lt"
		| "lte"
		| "in"
		| "contains"
		| "isNull"
		| "isNotNull";
	field: string;
	value?: unknown;
};

type LegacySort = {
	direction: "asc" | "desc";
	fields: string[];
};

type ComputedField = {
	key: string;
	expression: ViewExpression;
};

type GridDisplayConfiguration = {
	badgeProperty: ExpressionInput | null;
	titleProperty: ExpressionInput | null;
	imageProperty: ExpressionInput | null;
	subtitleProperty: ExpressionInput | null;
};

type ListDisplayConfiguration = GridDisplayConfiguration;

type TableDisplayConfiguration = {
	columns: Array<{
		label: string;
		expression?: ExpressionInput;
		property?: string[];
	}>;
};

type RuntimeRequest = Omit<
	ExecuteViewRuntimeBody,
	"displayConfiguration" | "fields" | "layout" | "sort" | "filter" | "filters"
> & {
	fields: RuntimeField[];
	filter?: ViewPredicate | null;
	filters?: LegacyFilter[];
	sort: LegacySort | ExecuteViewRuntimeBody["sort"];
	entitySchemaSlugs: string[];
	computedFields?: ComputedField[];
	eventJoins: NonNullable<ExecuteViewRuntimeBody["eventJoins"]>;
};

function literalExpression(value: unknown | null): ViewExpression {
	return { type: "literal", value };
}

function parseReference(reference: string): RuntimeRef {
	const [namespace, segment, tail, ...rest] = reference.split(".");
	if (namespace === "computed") {
		if (!segment || tail || rest.length > 0) {
			throw new Error(`Invalid runtime reference '${reference}'`);
		}

		return { type: "computed-field", key: segment };
	}

	if (namespace === "event") {
		if (!segment || !tail || rest.length > 0) {
			throw new Error(`Invalid runtime reference '${reference}'`);
		}

		return tail.startsWith("@")
			? { type: "event-join-column", joinKey: segment, column: tail.slice(1) }
			: { type: "event-join-property", joinKey: segment, property: tail };
	}

	if (namespace !== "entity" || !segment || !tail || rest.length > 0) {
		throw new Error(`Invalid runtime reference '${reference}'`);
	}

	return tail.startsWith("@")
		? { type: "entity-column", slug: segment, column: tail.slice(1) }
		: { type: "schema-property", slug: segment, property: tail };
}

function toExpression(input: ExpressionInput | null): ViewExpression | null {
	if (input === null) {
		return null;
	}

	if (!Array.isArray(input)) {
		return input;
	}

	if (!input.length) {
		return literalExpression(null);
	}

	const values = input.map((reference) => ({
		type: "reference" as const,
		reference: parseReference(reference),
	}));

	return values.length === 1
		? (values[0] ?? literalExpression(null))
		: { type: "coalesce", values };
}

function toPredicate(filter: LegacyFilter): ViewPredicate {
	const expression = toExpression([filter.field]) ?? literalExpression(null);
	if (filter.op === "isNull") {
		return { type: "isNull", expression };
	}

	if (filter.op === "isNotNull") {
		return { type: "isNotNull", expression };
	}

	if (filter.op === "contains") {
		return {
			type: "contains",
			expression,
			value: literalExpression(filter.value ?? null),
		};
	}

	if (filter.op === "in") {
		return {
			type: "in",
			expression,
			values: Array.isArray(filter.value)
				? filter.value.map((value) => literalExpression(value))
				: [literalExpression(filter.value ?? null)],
		};
	}

	return {
		left: expression,
		type: "comparison",
		operator: filter.op,
		right: literalExpression(filter.value ?? null),
	};
}

function getFilterGroupKey(filter: LegacyFilter) {
	const reference = parseReference(filter.field);
	return reference.type === "entity-column" ||
		reference.type === "schema-property"
		? reference.slug
		: `${reference.type}:${JSON.stringify(reference)}`;
}

function combinePredicates(predicates: ViewPredicate[], type: "and" | "or") {
	if (!predicates.length) {
		return null;
	}

	if (predicates.length === 1) {
		return predicates[0] ?? null;
	}

	return { type, predicates } satisfies ViewPredicate;
}

function toFilterPredicate(
	filters?: LegacyFilter[],
	filter?: ViewPredicate | null,
) {
	if (filter !== undefined) {
		return filter;
	}

	if (!filters?.length) {
		return null;
	}

	const grouped = new Map<string, ViewPredicate[]>();
	for (const entry of filters) {
		const key = getFilterGroupKey(entry);
		const existing = grouped.get(key) ?? [];
		existing.push(toPredicate(entry));
		grouped.set(key, existing);
	}

	const groupedPredicates = Array.from(grouped.values())
		.map((predicates) => combinePredicates(predicates, "and"))
		.filter((predicate): predicate is ViewPredicate => predicate !== null);

	return combinePredicates(groupedPredicates, "or");
}

function normalizeSort(sort: RuntimeRequest["sort"]) {
	if ("expression" in sort) {
		return sort;
	}

	return {
		direction: sort.direction,
		expression: toExpression(sort.fields) ?? literalExpression(null),
	};
}

function qualifyProperty(schemaSlug: string, property: string) {
	if (
		property === "id" ||
		property === "name" ||
		property === "image" ||
		property === "createdAt" ||
		property === "updatedAt"
	) {
		return `entity.${schemaSlug}.@${property}`;
	}

	return `entity.${schemaSlug}.${property}`;
}

function qualifyBuiltinFields(schemaSlugs: string[], property: string) {
	return schemaSlugs.map((schemaSlug) => qualifyProperty(schemaSlug, property));
}

interface CreateEntityInput {
	name: string;
	client: Client;
	cookies: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: { kind: "remote"; url: string } | null;
}

interface CreateRuntimeEventInput {
	client: Client;
	cookies: string;
	entityId: string;
	eventSchemaId: string;
	properties: Record<string, unknown>;
}

export function buildGridDisplayConfiguration(
	overrides: Partial<GridDisplayConfiguration> = {},
	schemaSlugs: string[] = [],
): GridDisplayConfiguration {
	const schemaSlug = schemaSlugs[0];

	return {
		subtitleProperty: schemaSlug ? [qualifyProperty(schemaSlug, "year")] : null,
		titleProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "name")
			: null,
		imageProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "image")
			: null,
		badgeProperty: schemaSlug
			? [qualifyProperty(schemaSlug, "category")]
			: null,
		...overrides,
	};
}

export function buildListDisplayConfiguration(
	overrides: Partial<ListDisplayConfiguration> = {},
	schemaSlugs: string[] = [],
): ListDisplayConfiguration {
	const schemaSlug = schemaSlugs[0];

	return {
		subtitleProperty: schemaSlug ? [qualifyProperty(schemaSlug, "year")] : null,
		titleProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "name")
			: null,
		imageProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "image")
			: null,
		badgeProperty: schemaSlug
			? [qualifyProperty(schemaSlug, "category")]
			: null,
		...overrides,
	};
}

export function buildTableDisplayConfiguration(
	columns?: TableDisplayConfiguration["columns"],
	schemaSlugs: string[] = [],
): TableDisplayConfiguration {
	return {
		columns:
			columns ??
			(schemaSlugs.length
				? [
						{
							label: "Name",
							expression: qualifyBuiltinFields(schemaSlugs, "name"),
						},
					]
				: []),
	};
}

const toRuntimeFields = (input: {
	layout: "grid" | "list" | "table";
	displayConfiguration:
		| GridDisplayConfiguration
		| ListDisplayConfiguration
		| TableDisplayConfiguration;
}): RuntimeField[] => {
	if (input.layout === "table") {
		return (
			input.displayConfiguration as TableDisplayConfiguration
		).columns.map((column, index) => ({
			key: `column_${index}`,
			expression:
				toExpression(column.expression ?? column.property ?? []) ??
				literalExpression(null),
		}));
	}

	const config = input.displayConfiguration as GridDisplayConfiguration;
	return [
		{
			key: "image",
			expression: toExpression(config.imageProperty) ?? literalExpression(null),
		},
		{
			key: "title",
			expression: toExpression(config.titleProperty) ?? literalExpression(null),
		},
		{
			key: "subtitle",
			expression:
				toExpression(config.subtitleProperty) ?? literalExpression(null),
		},
		{
			key: "badge",
			expression: toExpression(config.badgeProperty) ?? literalExpression(null),
		},
	];
};

export function buildRuntimeField(
	key: string,
	expression: ExpressionInput,
): RuntimeField {
	return {
		key,
		expression: toExpression(expression) ?? literalExpression(null),
	};
}

export function buildComputedField(
	key: string,
	expression: ExpressionInput,
): ComputedField {
	return {
		key,
		expression: toExpression(expression) ?? literalExpression(null),
	};
}

export function buildGridRequest(
	overrides: Partial<Omit<RuntimeRequest, "fields">> & {
		displayConfiguration?: GridDisplayConfiguration;
		entitySchemaSlugs: string[];
	},
): RuntimeRequest {
	const {
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const schemaSlugs = requestOverrides.entitySchemaSlugs;
	const displayConfiguration =
		displayConfigurationOverride ??
		buildGridDisplayConfiguration({}, schemaSlugs);

	return {
		computedFields: [],
		filters: [],
		eventJoins: [],
		pagination: { page: 1, limit: 10 },
		fields: toRuntimeFields({ layout: "grid", displayConfiguration }),
		sort: {
			direction: "asc",
			fields: schemaSlugs.length
				? qualifyBuiltinFields(schemaSlugs, "name")
				: [],
		},
		...requestOverrides,
	};
}

export function buildListRequest(
	overrides: Partial<Omit<RuntimeRequest, "fields">> & {
		displayConfiguration?: ListDisplayConfiguration;
		entitySchemaSlugs: string[];
	},
): RuntimeRequest {
	const {
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const schemaSlugs = requestOverrides.entitySchemaSlugs;
	const displayConfiguration =
		displayConfigurationOverride ??
		buildListDisplayConfiguration({}, schemaSlugs);

	return {
		filters: [],
		eventJoins: [],
		computedFields: [],
		pagination: { page: 1, limit: 10 },
		fields: toRuntimeFields({ layout: "list", displayConfiguration }),
		sort: {
			direction: "asc",
			fields: schemaSlugs.length
				? qualifyBuiltinFields(schemaSlugs, "name")
				: [],
		},
		...requestOverrides,
	};
}

export function buildTableRequest(
	overrides: Partial<Omit<RuntimeRequest, "fields">> & {
		displayConfiguration?: TableDisplayConfiguration;
		entitySchemaSlugs: string[];
	},
): RuntimeRequest {
	const {
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ??
		buildTableDisplayConfiguration(
			undefined,
			requestOverrides.entitySchemaSlugs,
		);

	return {
		filters: [],
		eventJoins: [],
		computedFields: [],
		pagination: { page: 1, limit: 10 },
		fields: toRuntimeFields({ layout: "table", displayConfiguration }),
		sort: {
			direction: "asc",
			fields: requestOverrides.entitySchemaSlugs.length
				? qualifyBuiltinFields(requestOverrides.entitySchemaSlugs, "name")
				: [],
		},
		...requestOverrides,
	};
}

export async function executeViewRuntime(
	client: Client,
	cookies: string,
	body: RuntimeRequest,
) {
	const normalizedBody = {
		...body,
		filter: toFilterPredicate(body.filters, body.filter),
		sort: normalizeSort(body.sort),
	};
	delete (normalizedBody as Partial<RuntimeRequest>).filters;

	return client.POST("/view-runtime/execute", {
		headers: { Cookie: cookies },
		body: normalizedBody as unknown as ExecuteViewRuntimeBody,
	});
}

export async function createRuntimeEntity(input: CreateEntityInput) {
	const { data, response } = await input.client.POST("/entities", {
		headers: { Cookie: input.cookies },
		body: {
			name: input.name,
			properties: input.properties,
			entitySchemaId: input.entitySchemaId,
			image:
				input.image === undefined
					? ({
							kind: "remote",
							url: `https://example.com/${input.name.toLowerCase().replace(/\s+/g, "-")}.png`,
						} as const)
					: input.image,
		},
	});

	if (response.status !== 200 || !data?.data?.id) {
		throw new Error(`Failed to create entity '${input.name}'`);
	}

	return data.data.id;
}

export async function createRuntimeEvent(input: CreateRuntimeEventInput) {
	const { data, response } = await input.client.POST("/events", {
		headers: { Cookie: input.cookies },
		body: [
			{
				entityId: input.entityId,
				properties: input.properties,
				eventSchemaId: input.eventSchemaId,
			},
		],
	});

	if (response.status !== 200 || data?.data?.count !== 1) {
		throw new Error(`Failed to create event for '${input.entityId}'`);
	}

	return data.data.count;
}

export async function createSingleSchemaRuntimeFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, cookies, {
		name: "Device Tracker",
	});
	const schema = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Device",
		propertiesSchema: {
			fields: {
				year: { type: "integer" },
				category: { type: "string" },
				manufacturer: { type: "string" },
			},
		},
	});

	const entities = [
		{
			name: "Alpha Phone",
			properties: { year: 2018, category: "phone", manufacturer: "Acme" },
		},
		{
			name: "Beta Tablet",
			properties: { year: 2019, category: "tablet", manufacturer: "Tabula" },
		},
		{
			name: "Gamma Phone",
			properties: { year: 2020, category: "phone", manufacturer: "Zenith" },
		},
		{
			name: "Delta Watch",
			properties: { year: 2021, category: "wearable", manufacturer: "Orbit" },
		},
		{
			name: "Omega Prototype",
			properties: { manufacturer: "Ghost" },
		},
	];
	const entityIdsByName: Record<string, string> = {};

	for (const entity of entities) {
		entityIdsByName[entity.name] = await createRuntimeEntity({
			client,
			cookies,
			name: entity.name,
			properties: entity.properties,
			entitySchemaId: schema.schemaId,
		});
	}

	return { client, cookies, schema, entityIdsByName };
}

export async function createCrossSchemaRuntimeFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, cookies, {
		name: "Mixed Device Tracker",
	});
	const smartphoneSchema = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Smartphone",
		slug: `smartphones-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				year: { type: "integer" },
				category: { type: "string" },
				manufacturer: { type: "string" },
			},
		},
	});
	const tabletSchema = await createEntitySchema(client, cookies, {
		trackerId,
		icon: "tablet",
		name: "Tablet",
		slug: `tablets-${crypto.randomUUID()}`,
		propertiesSchema: {
			fields: {
				maker: { type: "string" },
				category: { type: "string" },
				releaseYear: { type: "integer" },
				releaseLabel: { type: "string" },
			},
		},
	});

	const entities = [
		{
			name: "Alpha Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2018, category: "phone", manufacturer: "Acme" },
		},
		{
			name: "Gamma Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2020, category: "phone", manufacturer: "Zenith" },
		},
		{
			name: "Omega Phone",
			entitySchemaId: smartphoneSchema.schemaId,
			properties: { year: 2024, manufacturer: "Nova" },
		},
		{
			name: "Beta Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: {
				maker: "Tabula",
				releaseYear: 2019,
				category: "tablet",
				releaseLabel: "2019",
			},
		},
		{
			name: "Delta Tablet",
			entitySchemaId: tabletSchema.schemaId,
			properties: {
				maker: "Slate",
				releaseYear: 2021,
				category: "tablet",
				releaseLabel: "2021",
			},
		},
	];
	const entityIdsByName: Record<string, string> = {};

	for (const entity of entities) {
		entityIdsByName[entity.name] = await createRuntimeEntity({
			client,
			cookies,
			name: entity.name,
			properties: entity.properties,
			entitySchemaId: entity.entitySchemaId,
		});
	}

	return {
		client,
		cookies,
		tabletSchema,
		entityIdsByName,
		smartphoneSchema,
		tabletSlug: tabletSchema.slug,
		smartphoneSlug: smartphoneSchema.slug,
	};
}
