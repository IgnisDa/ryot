import type { paths } from "@ryot/generated/openapi/app-backend";
import { type Client, createAuthenticatedClient } from "./auth";
import { createEntitySchema } from "./entity-schemas";
import { createTracker } from "./trackers";
import {
	type ExpressionInput,
	entityField,
	type LegacyFilter,
	type LegacySort,
	normalizeSort,
	qualifyBuiltinFields,
	toFilterPredicate,
	toRequiredExpression,
	type ViewExpression,
	type ViewPredicate,
} from "./view-language";

type ExecuteViewRuntimeBody = NonNullable<
	paths["/view-runtime/execute"]["post"]["requestBody"]
>["content"]["application/json"];
type ComputedField = NonNullable<
	ExecuteViewRuntimeBody["computedFields"]
>[number];

type RuntimeField = {
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

type RuntimeFieldsInput =
	| {
			layout: "table";
			displayConfiguration: TableDisplayConfiguration;
	  }
	| {
			layout: "grid" | "list";
			displayConfiguration: GridDisplayConfiguration | ListDisplayConfiguration;
	  };

type RuntimeRequest = Omit<
	ExecuteViewRuntimeBody,
	"displayConfiguration" | "fields" | "layout" | "sort" | "filter" | "filters"
> & {
	fields: RuntimeField[];
	filters?: LegacyFilter[];
	entitySchemaSlugs: string[];
	filter?: ViewPredicate | null;
	computedFields?: ComputedField[];
	sort: LegacySort | ExecuteViewRuntimeBody["sort"];
	eventJoins: NonNullable<ExecuteViewRuntimeBody["eventJoins"]>;
};

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

const buildCardDisplayConfiguration = (
	schemaSlugs: string[],
	overrides: Partial<GridDisplayConfiguration> = {},
): GridDisplayConfiguration => {
	const schemaSlug = schemaSlugs[0];

	return {
		subtitleProperty: schemaSlug ? [entityField(schemaSlug, "year")] : null,
		titleProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "name")
			: null,
		imageProperty: schemaSlugs.length
			? qualifyBuiltinFields(schemaSlugs, "image")
			: null,
		badgeProperty: schemaSlug ? [entityField(schemaSlug, "category")] : null,
		...overrides,
	};
};

export function buildGridDisplayConfiguration(
	overrides: Partial<GridDisplayConfiguration> = {},
	schemaSlugs: string[] = [],
): GridDisplayConfiguration {
	return buildCardDisplayConfiguration(schemaSlugs, overrides);
}

export function buildListDisplayConfiguration(
	overrides: Partial<ListDisplayConfiguration> = {},
	schemaSlugs: string[] = [],
): ListDisplayConfiguration {
	return buildCardDisplayConfiguration(schemaSlugs, overrides);
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

function toRuntimeFields(input: RuntimeFieldsInput): RuntimeField[] {
	if (input.layout === "table") {
		return input.displayConfiguration.columns.map((column, index) => ({
			key: `column_${index}`,
			expression: toRequiredExpression(
				column.expression ?? column.property ?? [],
			),
		}));
	}

	const config = input.displayConfiguration;
	return [
		{
			key: "image",
			expression: toRequiredExpression(config.imageProperty),
		},
		{
			key: "title",
			expression: toRequiredExpression(config.titleProperty),
		},
		{
			key: "subtitle",
			expression: toRequiredExpression(config.subtitleProperty),
		},
		{
			key: "badge",
			expression: toRequiredExpression(config.badgeProperty),
		},
	];
}

export function buildRuntimeField(
	key: string,
	expression: ExpressionInput,
): RuntimeField {
	return {
		key,
		expression: toRequiredExpression(expression),
	};
}

export function buildComputedField(
	key: string,
	expression: ExpressionInput,
): ComputedField {
	return {
		key,
		expression: toRequiredExpression(expression),
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
	const { filters: _filters, ...requestBody } = normalizedBody;

	return client.POST("/view-runtime/execute", {
		body: requestBody,
		headers: { Cookie: cookies },
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
