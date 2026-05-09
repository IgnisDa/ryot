import type { components, paths } from "@ryot/generated/openapi/app-backend";

import type { Client } from "./auth";
import { type PollOptions, pollUntil } from "./polling";
import { createTracker, listTrackers } from "./trackers";

type EnqueueEntitySearchBody = NonNullable<
	paths["/entity-schemas/search"]["post"]["requestBody"]
>["content"]["application/json"];

type PollEntitySearchResponse =
	paths["/entity-schemas/search/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

type EnqueueEntityImportBody = NonNullable<
	paths["/entity-schemas/import"]["post"]["requestBody"]
>["content"]["application/json"];

type PollEntityImportResponse =
	paths["/entity-schemas/import/{jobId}"]["get"]["responses"][200]["content"]["application/json"]["data"];

export type AppPropertyDefinition = components["schemas"]["AppPropertyDefinition"];

type PostEntitySchemaBody = NonNullable<
	paths["/entity-schemas"]["post"]["requestBody"]
>["content"]["application/json"];

export type AppSchema = PostEntitySchemaBody["propertiesSchema"];

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
			fields: {
				title: {
					label: "Title",
					description: "Title",
					type: "string" as const,
				},
			},
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

export async function getEntitySchema(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client.GET("/entity-schemas/{entitySchemaId}", {
		headers: { Cookie: cookies },
		params: { path: { entitySchemaId } },
	});

	if (response.status !== 200 || !data?.data) {
		throw new Error(`Failed to get entity schema '${entitySchemaId}'`);
	}

	return data.data;
}

export async function findBuiltinEntitySchema(client: Client, cookies: string) {
	const { schemas, builtinTracker } = await listBuiltinEntitySchemas(client, cookies);
	const firstSchema = schemas[0];

	if (!firstSchema) {
		throw new Error("No built-in entity schema found");
	}

	return { builtinTracker, schema: firstSchema };
}

export async function findBuiltinSchemaBySlug(client: Client, cookies: string, slug: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const builtinTrackers = trackers.filter((tracker) => tracker.isBuiltin);

	for (const builtinTracker of builtinTrackers) {
		// oxlint-disable-next-line no-await-in-loop
		const schemas = await listEntitySchemas(client, cookies, {
			slugs: [slug],
			trackerId: builtinTracker.id,
		});
		const schema = schemas[0];

		if (schema) {
			return { schema, builtinTracker };
		}
	}

	throw new Error(`Built-in entity schema '${slug}' not found`);
}

export async function listBuiltinEntitySchemas(client: Client, cookies: string) {
	const trackers = await listTrackers(client, cookies, {
		includeDisabled: true,
	});
	const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
	if (!builtinTracker) {
		throw new Error("Built-in tracker not found");
	}
	const schemas = await listEntitySchemas(client, cookies, {
		trackerId: builtinTracker.id,
	});
	return { schemas, builtinTracker };
}

export async function findBuiltinSchemaWithProviders(client: Client, cookies: string) {
	return findBuiltinSchemaBySlug(client, cookies, "book");
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
	options: PollOptions = {},
) {
	return pollUntil(
		`entity search job '${jobId}'`,
		async () => {
			const { data, response } = await client.GET("/entity-schemas/search/{jobId}", {
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			if (response.status !== 200 || !data?.data) {
				throw new Error(`Failed to poll entity search result '${jobId}'`);
			}
			const result: PollEntitySearchResponse = data.data;
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}

export async function enqueueEntityImport(
	client: Client,
	cookies: string,
	body: EnqueueEntityImportBody,
) {
	const { data, response } = await client.POST("/entity-schemas/import", {
		body,
		headers: { Cookie: cookies },
	});

	if (response.status !== 200 || !data?.data?.jobId) {
		throw new Error("Failed to enqueue entity import");
	}

	return { jobId: data.data.jobId };
}

export async function pollEntityImportResult(
	client: Client,
	cookies: string,
	jobId: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`entity import job '${jobId}'`,
		async () => {
			const { data, response } = await client.GET("/entity-schemas/import/{jobId}", {
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			if (response.status !== 200 || !data?.data) {
				throw new Error(`Failed to poll entity import result '${jobId}'`);
			}
			const result: PollEntityImportResponse = data.data;
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}

export function getFirstProviderScriptId(schema: { providers: Array<{ scriptId: string }> }) {
	const scriptId = schema.providers[0]?.scriptId;
	if (!scriptId) {
		throw new Error("No provider found for schema");
	}
	return scriptId;
}

export async function createTrackerWithSchema(
	client: Client,
	cookies: string,
	options: Partial<Omit<CreateEntitySchemaOptions, "trackerId">> = {},
) {
	const { trackerId } = await createTracker(client, cookies);
	const { schemaId, slug, data } = await createEntitySchema(client, cookies, {
		...options,
		trackerId,
	});
	return { trackerId, schemaId, slug, data };
}
