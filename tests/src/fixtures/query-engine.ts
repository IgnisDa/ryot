import type { paths } from "@ryot/generated/openapi/app-backend";
import { getQueryEngineField } from "@ryot/ts-utils/query-engine";

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
	type ViewPredicate,
} from "./view-language";

type ExecuteQueryEngineBody = NonNullable<
	paths["/query-engine/execute"]["post"]["requestBody"]
>["content"]["application/json"];
type ExecuteQueryEngineResponse =
	paths["/query-engine/execute"]["post"]["responses"][200]["content"]["application/json"];
type EntitiesBody = Extract<ExecuteQueryEngineBody, { mode: "entities" }>;
type ComputedField = NonNullable<ExecuteQueryEngineBody["computedFields"]>[number];
type QueryEngineResponseItem = Extract<
	ExecuteQueryEngineResponse,
	{ mode: "entities" }
>["data"]["items"][number];

type QueryEngineField = {
	key: string;
	kind: QueryEngineResponseItem[string]["kind"];
	value: QueryEngineResponseItem[string]["value"];
};

type RuntimeField = {
	key: string;
	expression: ViewExpression;
};

export type QueryEngineRequest = Omit<EntitiesBody, "fields" | "mode"> & {
	fields: RuntimeField[];
	mode?: ExecuteQueryEngineBody["mode"];
};

type TableDisplayConfiguration = DisplayConfigurationInput["table"];

type RuntimeFieldsInput =
	| {
			layout: "table";
			displayConfiguration: TableDisplayConfiguration;
	  }
	| {
			layout: "grid" | "list";
			displayConfiguration: CardDisplayConfigurationInput;
	  };

export function toQueryEngineItem(fields: QueryEngineField[]): QueryEngineResponseItem {
	return Object.fromEntries(
		fields.map(({ key, ...field }) => [key, field]),
	) as QueryEngineResponseItem;
}

interface CreateEntityInput {
	name: string;
	client: Client;
	cookies: string;
	entitySchemaId: string;
	properties: Record<string, unknown>;
	image?: { type: "remote"; url: string } | null;
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
	image?: { type: "remote"; url: string } | null;
};

const buildCardDisplayConfiguration = (
	schemaSlugs: string[],
	overrides: Partial<CardDisplayConfigurationInput> = {},
): CardDisplayConfigurationInput => {
	const schemaSlug = schemaSlugs[0];

	return {
		secondarySubtitleProperty: null,
		calloutProperty: schemaSlug ? [entityField(schemaSlug, "category")] : null,
		primarySubtitleProperty: schemaSlug ? [entityField(schemaSlug, "year")] : null,
		titleProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "name") : null,
		imageProperty: schemaSlugs.length ? qualifyBuiltinFields(schemaSlugs, "image") : null,
		...overrides,
	};
};

export function buildGridDisplayConfiguration(
	overrides: Partial<CardDisplayConfigurationInput> = {},
	schemaSlugs: string[] = [],
): CardDisplayConfigurationInput {
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

const defaultSort = (schemaSlugs: string[]): EntitiesBody["sort"] => ({
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
	relationshipJoins: [],
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

type RelationshipJoinInput = {
	key: string;
	required?: boolean;
	sourceEntityId?: string;
	targetEntityId?: string;
	filter?: ViewPredicate | null;
	relationshipSchemaSlug: string;
	direction: "outgoing" | "incoming";
};

export function buildLatestRelationshipJoin(input: RelationshipJoinInput) {
	return {
		key: input.key,
		direction: input.direction,
		required: input.required ?? false,
		kind: "latestRelationship" as const,
		relationshipSchemaSlug: input.relationshipSchemaSlug,
		...(input.sourceEntityId !== undefined && { sourceEntityId: input.sourceEntityId }),
		...(input.targetEntityId !== undefined && { targetEntityId: input.targetEntityId }),
		...(input.filter !== undefined && { filter: input.filter }),
	};
}

export function buildRequiredLatestRelationshipJoin(
	input: Omit<RelationshipJoinInput, "required">,
) {
	return buildLatestRelationshipJoin({ ...input, required: true });
}

export const buildInLibraryRelationshipJoin = (required = true) =>
	buildLatestRelationshipJoin({
		required,
		key: "inLibrary",
		direction: "outgoing",
		relationshipSchemaSlug: "in-library",
	});

export function buildGridRequest(
	overrides: Partial<Omit<QueryEngineRequest, "fields">> & {
		scope: string[];
		displayConfiguration?: CardDisplayConfigurationInput;
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
		displayConfiguration?: CardDisplayConfigurationInput;
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

type EntitiesQueryEngineResponse = Extract<ExecuteQueryEngineResponse, { mode: "entities" }>;

export async function executeQueryEngine(
	client: Client,
	cookies: string,
	body: QueryEngineRequest,
) {
	const mode = body.mode ?? "entities";
	const result = await client.POST("/query-engine/execute", {
		// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
		body: { ...body, mode } as unknown as ExecuteQueryEngineBody,
		headers: { Cookie: cookies },
	});

	return {
		error: result.error,
		response: result.response,
		// oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
		data: result.data as unknown as EntitiesQueryEngineResponse,
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
							type: "remote",
							url: `https://example.com/${input.name.toLowerCase().replace(/\s+/g, "-")}.png`,
						} as const)
					: input.image,
		},
	});

	if (response.status !== 200 || !data?.data.id) {
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

	if (response.status !== 200 || data?.data.count !== 1) {
		throw new Error(`Failed to create event for '${input.entityId}'`);
	}

	await waitForEventCount(input.client, input.cookies, input.entityId, beforeCount + 1);
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
