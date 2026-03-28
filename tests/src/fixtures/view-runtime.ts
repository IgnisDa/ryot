import type { paths } from "@ryot/generated/openapi/app-backend";
import { type Client, createAuthenticatedClient } from "./auth";
import { createEntitySchema } from "./entity-schemas";
import { createTracker } from "./trackers";

type ExecuteViewRuntimeBody = NonNullable<
	paths["/view-runtime/execute"]["post"]["requestBody"]
>["content"]["application/json"];
type GridRequest = Extract<ExecuteViewRuntimeBody, { layout: "grid" }>;
type ListRequest = Extract<ExecuteViewRuntimeBody, { layout: "list" }>;
type TableRequest = Extract<ExecuteViewRuntimeBody, { layout: "table" }>;

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
	overrides: Partial<GridRequest["displayConfiguration"]> = {},
	schemaSlugs: string[] = [],
): GridRequest["displayConfiguration"] {
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
	overrides: Partial<ListRequest["displayConfiguration"]> = {},
	schemaSlugs: string[] = [],
): ListRequest["displayConfiguration"] {
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
	columns?: TableRequest["displayConfiguration"]["columns"],
	schemaSlugs: string[] = [],
): TableRequest["displayConfiguration"] {
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

export function buildGridRequest(
	overrides: Partial<Omit<GridRequest, "layout">> &
		Pick<GridRequest, "entitySchemaSlugs">,
): GridRequest {
	const schemaSlugs = overrides.entitySchemaSlugs;

	return {
		filters: [],
		eventJoins: [],
		layout: "grid",
		pagination: { page: 1, limit: 10 },
		displayConfiguration: buildGridDisplayConfiguration({}, schemaSlugs),
		sort: {
			direction: "asc",
			fields: schemaSlugs.length
				? qualifyBuiltinFields(schemaSlugs, "name")
				: [],
		},
		...overrides,
	};
}

export function buildListRequest(
	overrides: Partial<Omit<ListRequest, "layout">> &
		Pick<ListRequest, "entitySchemaSlugs">,
): ListRequest {
	const schemaSlugs = overrides.entitySchemaSlugs;

	return {
		filters: [],
		layout: "list",
		eventJoins: [],
		pagination: { page: 1, limit: 10 },
		displayConfiguration: buildListDisplayConfiguration({}, schemaSlugs),
		sort: {
			direction: "asc",
			fields: schemaSlugs.length
				? qualifyBuiltinFields(schemaSlugs, "name")
				: [],
		},
		...overrides,
	};
}

export function buildTableRequest(
	overrides: Partial<Omit<TableRequest, "layout">> &
		Pick<TableRequest, "entitySchemaSlugs">,
): TableRequest {
	return {
		filters: [],
		eventJoins: [],
		layout: "table",
		pagination: { page: 1, limit: 10 },
		displayConfiguration: buildTableDisplayConfiguration(
			undefined,
			overrides.entitySchemaSlugs,
		),
		sort: {
			direction: "asc",
			fields: overrides.entitySchemaSlugs.length
				? qualifyBuiltinFields(overrides.entitySchemaSlugs, "name")
				: [],
		},
		...overrides,
	};
}

export async function executeViewRuntime(
	client: Client,
	cookies: string,
	body: ExecuteViewRuntimeBody,
) {
	return client.POST("/view-runtime/execute", {
		body,
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
