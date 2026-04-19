import type { components, paths } from "@ryot/generated/openapi/app-backend";
import { dayjs } from "@ryot/ts-utils";
import type { Client } from "./auth";
import { findBuiltinTracker } from "./trackers";

type EnqueueEntitySearchBody = NonNullable<
	paths["/entity-schemas/search"]["post"]["requestBody"]
>["content"]["application/json"];

type PollEntitySearchResponse =
	paths["/entity-schemas/search/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export interface PollEntitySearchOptions {
	timeoutMs?: number;
	intervalMs?: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type AppPropertyDefinition = {
	type: string;
	label?: string;
	unknownKeys?: string;
	items?: AppPropertyDefinition;
	transform?: Record<string, unknown>;
	validation?: Record<string, unknown>;
	properties?: Record<string, AppPropertyDefinition>;
};

export type AppSchema = {
	fields: Record<string, AppPropertyDefinition>;
	rules?: components["schemas"]["AppSchemaRule"][];
};

export interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	trackerId: string;
	accentColor?: string;
	propertiesSchema?: AppSchema;
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
		propertiesSchema = {
			fields: { title: { type: "string" as const, label: "Title" } },
		},
	} = options;

	const { data, response } = await client.POST("/entity-schemas", {
		headers: { Cookie: cookies },
		body: {
			icon,
			name,
			slug,
			trackerId,
			accentColor,
			propertiesSchema,
		} as never,
	});

	if (response.status !== 200 || !data?.data?.id || !data.data.slug) {
		throw new Error(`Failed to create entity schema '${name}'`);
	}

	return { schemaId: data.data.id, slug: data.data.slug, data: data.data };
}

export async function listEntitySchemas(
	client: Client,
	cookies: string,
	options: { slugs?: string[]; trackerId?: string },
) {
	const { data, response } = await client.POST("/entity-schemas/list", {
		body: options,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error("Failed to list entity schemas");
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
	const schemas = await listEntitySchemas(client, cookies, {
		trackerId: builtinTracker.id,
	});
	const firstSchema = schemas[0];

	if (!firstSchema) {
		throw new Error("No built-in entity schema found");
	}

	return { builtinTracker, schema: firstSchema };
}

export async function findBuiltinSchemaWithProviders(
	client: Client,
	cookies: string,
) {
	const builtinTracker = await findBuiltinTracker(client, cookies);
	const schemas = await listEntitySchemas(client, cookies, {
		slugs: ["book"],
		trackerId: builtinTracker.id,
	});
	const schema = schemas[0];

	if (!schema) {
		throw new Error("Built-in book schema not found");
	}

	return { schema, builtinTracker };
}

export async function enqueueEntitySearch(
	client: Client,
	cookies: string,
	body: EnqueueEntitySearchBody,
) {
	const { data, response } = await client.POST("/entity-schemas/search", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.jobId) {
		throw new Error("Failed to enqueue entity search");
	}

	return { jobId: data.data.jobId };
}

export async function pollEntitySearchResult(
	client: Client,
	cookies: string,
	jobId: string,
	options: PollEntitySearchOptions = {},
) {
	const { intervalMs = 500, timeoutMs = 30_000 } = options;
	const deadline = dayjs().add(timeoutMs, "millisecond");

	for (;;) {
		const { data, response } = await client.GET(
			"/entity-schemas/search/{jobId}",
			{
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			},
		);

		if (response.status !== 200 || !data?.data) {
			throw new Error(`Failed to poll entity search result '${jobId}'`);
		}

		const result: PollEntitySearchResponse = data.data;
		if (result.status !== "pending") {
			return result;
		}

		const remainingMs = deadline.diff(dayjs());
		if (remainingMs <= 0) {
			break;
		}

		await delay(Math.min(intervalMs, remainingMs));
	}

	throw new Error(
		`Entity search job '${jobId}' did not reach a terminal state within ${timeoutMs}ms`,
	);
}
