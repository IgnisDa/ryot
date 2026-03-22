import type { Client } from "./auth";
import { findBuiltinTracker } from "./trackers";

export interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	trackerId: string;
	accentColor?: string;
	propertiesSchema?: Record<
		string,
		{ type: "boolean" | "date" | "integer" | "number" | "string" }
	>;
}

export async function createEntitySchema(
	client: Client,
	cookies: string,
	options: CreateEntitySchemaOptions,
) {
	const {
		trackerId,
		icon = "book",
		name = "Test Schema",
		accentColor = "#00FF00",
		slug = `schema-${crypto.randomUUID()}`,
		propertiesSchema = { title: { type: "string" as const } },
	} = options;

	const { data, response } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: { icon, name, slug, trackerId, accentColor, propertiesSchema },
	});

	if (response.status !== 200 || !data?.data?.id || !data.data.slug) {
		throw new Error(`Failed to create entity schema '${name}'`);
	}

	return { schemaId: data.data.id, slug: data.data.slug, data: data.data };
}

export async function listEntitySchemas(
	client: Client,
	cookies: string,
	trackerId: string,
) {
	const { data, response } = await client.GET("/entity-schemas", {
		headers: { Cookie: cookies },
		params: { query: { trackerId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to list entity schemas for tracker '${trackerId}'`);
	}

	return data.data;
}

export async function getEntitySchema(
	client: Client,
	cookies: string,
	entitySchemaId: string,
) {
	const { data, response } = await client.GET(
		"/entity-schemas/{entitySchemaId}",
		{
			headers: { Cookie: cookies },
			params: { path: { entitySchemaId } },
		},
	);

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to get entity schema '${entitySchemaId}'`);
	}

	return data.data;
}

export async function findBuiltinEntitySchema(client: Client, cookies: string) {
	const builtinTracker = await findBuiltinTracker(client, cookies);
	const schemas = await listEntitySchemas(client, cookies, builtinTracker.id);
	const firstSchema = schemas[0];

	if (!firstSchema) {
		throw new Error("No built-in entity schema found");
	}

	return { builtinTracker, schema: firstSchema };
}
