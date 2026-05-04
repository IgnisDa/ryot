import type { paths } from "@ryot/generated/openapi/app-backend";
import { getQueryEngineField } from "@ryot/ts-utils";

import { type Client, createAuthenticatedClient } from "./auth";
import { createEntitySchema } from "./entity-schemas";
import { waitForEventCount } from "./events";
import type { CardDisplayConfigurationInput, DisplayConfigurationInput } from "./saved-views";
import { createTracker } from "./trackers";
import {
	type ExpressionInput,
	entityField,
	qualifyBuiltinFields,
	toRequiredExpression,
	type ViewExpression,
} from "./view-language";

type ExecuteQueryEngineBody = Extract<
	NonNullable<paths["/query-engine/execute"]["post"]["requestBody"]>["content"]["application/json"],
	{ mode: "entities" }
>;
type ExecuteQueryEngineResponse =
	paths["/query-engine/execute"]["post"]["responses"][200]["content"]["application/json"];
type ExecuteEntityQueryEngineResponse = Extract<
	ExecuteQueryEngineResponse["data"],
	{ mode: "entities" }
>;
type ComputedField = NonNullable<ExecuteQueryEngineBody["computedFields"]>[number];
type QueryEngineResponseItem = Extract<
	ExecuteQueryEngineResponse["data"],
	{ mode: "entities" }
>["data"]["items"][number];

type RuntimeField = {
	key: string;
	expression: ViewExpression;
};

export type QueryEngineRequest = Omit<ExecuteQueryEngineBody, "fields" | "mode"> & {
	fields: RuntimeField[];
	mode?: ExecuteQueryEngineBody["mode"];
};

type GridDisplayConfiguration = CardDisplayConfigurationInput;
type ListDisplayConfiguration = CardDisplayConfigurationInput;
type TableDisplayConfiguration = DisplayConfigurationInput["table"];

type RuntimeFieldsInput =
	| {
			layout: "table";
			displayConfiguration: TableDisplayConfiguration;
	  }
	| {
			layout: "grid" | "list";
			displayConfiguration: GridDisplayConfiguration | ListDisplayConfiguration;
	  };

interface CreateEntityInput {
	name: string;
	client: Client;
	cookies: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: { kind: "remote"; url: string } | null;
}

interface CreateQueryEngineEventInput {
	client: Client;
	cookies: string;
	entityId: string;
	eventSchemaId: string;
	properties: Record<string, unknown>;
}

type QueryEngineEntityFixture = {
	name: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: { kind: "remote"; url: string } | null;
};

const buildCardDisplayConfiguration = (
	schemaSlugs: string[],
	overrides: Partial<GridDisplayConfiguration> = {},
): GridDisplayConfiguration => {
	const schemaSlug = schemaSlugs[0];

	return {
		calloutProperty: schemaSlug ? [entityField(schemaSlug, "category")] : null,
		titleProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "name") : null,
		imageProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "image") : null,
		primarySubtitleProperty: schemaSlug ? [entityField(schemaSlug, "year")] : null,
		secondarySubtitleProperty: null,
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

function toQueryEngineFields(input: RuntimeFieldsInput): RuntimeField[] {
	if (input.layout === "table") {
		return input.displayConfiguration.columns.map((column, index) => ({
			key: `column_${index}`,
			expression: toRequiredExpression(column.expression ?? column.property ?? []),
		}));
	}

	const config = input.displayConfiguration;
	return [
		{
			key: "image",
			expression: toRequiredExpression(config.imageProperty ?? null),
		},
		{
			key: "title",
			expression: toRequiredExpression(config.titleProperty ?? null),
		},
		{
			key: "primarySubtitle",
			expression: toRequiredExpression(config.primarySubtitleProperty ?? null),
		},
		{
			key: "secondarySubtitle",
			expression: toRequiredExpression(config.secondarySubtitleProperty ?? null),
		},
		{
			key: "callout",
			expression: toRequiredExpression(config.calloutProperty ?? null),
		},
	];
}

const defaultSort = (schemaSlugs: string[]): ExecuteQueryEngineBody["sort"] => ({
	direction: "asc",
	expression: toRequiredExpression(
		schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "name") : [],
	),
});

const buildQueryEngineRequest = (
	input: Partial<Omit<QueryEngineRequest, "fields" | "sort">> & {
		fields: RuntimeField[];
		scope: string[];
		sort?: QueryEngineRequest["sort"];
	},
): QueryEngineRequest => ({
	eventJoins: [],
	mode: "entities",
	computedFields: [],
	pagination: { page: 1, limit: 10 },
	sort: defaultSort(input.scope),
	...input,
});

export function buildQueryEngineField(key: string, expression: ExpressionInput): RuntimeField {
	return {
		key,
		expression: toRequiredExpression(expression),
	};
}

export function buildComputedField(key: string, expression: ExpressionInput): ComputedField {
	return {
		key,
		expression: toRequiredExpression(expression),
	};
}

export function buildGridRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		displayConfiguration?: GridDisplayConfiguration;
		scope: string[];
	},
): QueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildGridDisplayConfiguration({}, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "grid", displayConfiguration }),
		...requestOverrides,
	});
}

export function buildListRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: string[];
		displayConfiguration?: ListDisplayConfiguration;
	},
): QueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildListDisplayConfiguration({}, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "list", displayConfiguration }),
		...requestOverrides,
	});
}

export function buildTableRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: string[];
		displayConfiguration?: TableDisplayConfiguration;
	},
): QueryEngineRequest {
	const {
		scope,
		displayConfiguration: displayConfigurationOverride,
		...requestOverrides
	} = overrides;
	const displayConfiguration =
		displayConfigurationOverride ?? buildTableDisplayConfiguration(undefined, scope);

	return buildQueryEngineRequest({
		scope,
		fields: toQueryEngineFields({ layout: "table", displayConfiguration }),
		...requestOverrides,
	});
}

export function getQueryEngineFieldOrThrow(item: QueryEngineResponseItem | undefined, key: string) {
	const field = getQueryEngineField(item, key);
	if (!field) {
		throw new Error(`Expected query engine field '${key}'`);
	}

	return field;
}

export async function executeQueryEngine(
	client: Client,
	cookies: string,
	body: QueryEngineRequest,
) {
	const result = await client.POST("/query-engine/execute", {
		body: { ...body, mode: body.mode ?? "entities" },
		headers: { Cookie: cookies },
	});

	return {
		error: result.error,
		response: result.response,
		data: result.data?.data as ExecuteEntityQueryEngineResponse | undefined,
	};
}

export async function createQueryEngineEntity(input: CreateEntityInput) {
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

export async function createQueryEngineEvent(input: CreateQueryEngineEventInput) {
	const before = await input.client.GET("/events", {
		headers: { Cookie: input.cookies },
		params: { query: { entityId: input.entityId } },
	});
	const beforeCount = before.data?.data.length ?? 0;

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

	await waitForEventCount(input.client, input.cookies, input.entityId, beforeCount + 1);
	return data.data.count;
}

const createQueryEngineEntities = async (input: {
	client: Client;
	cookies: string;
	entities: QueryEngineEntityFixture[];
}) => {
	const entityIdsByName: Record<string, string> = {};

	for (const entity of input.entities) {
		// oxlint-disable-next-line no-await-in-loop
		entityIdsByName[entity.name] = await createQueryEngineEntity({
			name: entity.name,
			image: entity.image,
			client: input.client,
			cookies: input.cookies,
			properties: entity.properties,
			entitySchemaId: entity.entitySchemaId,
		});
	}

	return entityIdsByName;
};

export async function createSingleSchemaQueryEngineFixture() {
	const { client, cookies } = await createAuthenticatedClient();
	const { trackerId } = await createTracker(client, cookies, {
		name: "Device Tracker",
	});
	const schema = await createEntitySchema(client, cookies, {
		trackerId,
		name: "Device",
		propertiesSchema: {
			fields: {
				year: { type: "integer", label: "Year", description: "Year" },
				category: {
					type: "string",
					label: "Category",
					description: "Category",
				},
				manufacturer: {
					type: "string",
					label: "Manufacturer",
					description: "Manufacturer",
				},
			},
		},
	});

	const entities: QueryEngineEntityFixture[] = [
		{
			name: "Alpha Phone",
			entitySchemaId: schema.schemaId,
			properties: { year: 2018, category: "phone", manufacturer: "Acme" },
		},
		{
			name: "Beta Tablet",
			entitySchemaId: schema.schemaId,
			properties: { year: 2019, category: "tablet", manufacturer: "Tabula" },
		},
		{
			name: "Gamma Phone",
			entitySchemaId: schema.schemaId,
			properties: { year: 2020, category: "phone", manufacturer: "Zenith" },
		},
		{
			name: "Delta Watch",
			entitySchemaId: schema.schemaId,
			properties: { year: 2021, category: "wearable", manufacturer: "Orbit" },
		},
		{
			name: "Omega Prototype",
			entitySchemaId: schema.schemaId,
			properties: { manufacturer: "Ghost" },
		},
	];
	const entityIdsByName = await createQueryEngineEntities({
		client,
		cookies,
		entities,
	});

	return { client, cookies, schema, entityIdsByName };
}

export async function createCrossSchemaQueryEngineFixture() {
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
				year: { type: "integer", label: "Year", description: "Year" },
				category: {
					type: "string",
					label: "Category",
					description: "Category",
				},
				manufacturer: {
					type: "string",
					label: "Manufacturer",
					description: "Manufacturer",
				},
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
				maker: { type: "string", label: "Maker", description: "Maker" },
				category: {
					type: "string",
					label: "Category",
					description: "Category",
				},
				releaseYear: {
					type: "integer",
					label: "Release Year",
					description: "Release year",
				},
				releaseLabel: {
					type: "string",
					label: "Release Label",
					description: "Release label",
				},
			},
		},
	});

	const entities: QueryEngineEntityFixture[] = [
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
	const entityIdsByName = await createQueryEngineEntities({
		client,
		cookies,
		entities,
	});

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
