import type { paths } from "@ryot/generated/openapi/app-backend";
import { type Client, createAuthenticatedClient } from "./auth";
import { createEntitySchema } from "./entity-schemas";
import { createTracker } from "./trackers";

type ExecuteViewRuntimeBody = NonNullable<
	paths["/view-runtime/execute"]["post"]["requestBody"]
>["content"]["application/json"];

type RuntimeField = {
	key: string;
	references: string[];
};

type GridDisplayConfiguration = {
	badgeProperty: string[] | null;
	titleProperty: string[] | null;
	imageProperty: string[] | null;
	subtitleProperty: string[] | null;
};

type ListDisplayConfiguration = GridDisplayConfiguration;

type TableDisplayConfiguration = {
	columns: Array<{ label: string; property: string[] }>;
};

type RuntimeRequest = Omit<
	ExecuteViewRuntimeBody,
	"layout" | "displayConfiguration"
> & {
	fields: RuntimeField[];
	entitySchemaSlugs: string[];
	eventJoins: NonNullable<ExecuteViewRuntimeBody["eventJoins"]>;
};

function qualifyProperty(schemaSlug: string, property: string) {
	if (
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
							property: qualifyBuiltinFields(schemaSlugs, "name"),
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
			references: column.property,
		}));
	}

	const config = input.displayConfiguration as GridDisplayConfiguration;
	return [
		{ key: "image", references: config.imageProperty ?? [] },
		{ key: "title", references: config.titleProperty ?? [] },
		{ key: "subtitle", references: config.subtitleProperty ?? [] },
		{ key: "badge", references: config.badgeProperty ?? [] },
	];
};

export function buildRuntimeField(
	key: string,
	references: string[],
): RuntimeField {
	return { key, references };
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
	return client.POST("/view-runtime/execute", {
		headers: { Cookie: cookies },
		body: body as unknown as ExecuteViewRuntimeBody,
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
