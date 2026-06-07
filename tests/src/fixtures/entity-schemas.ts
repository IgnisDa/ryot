import type { AppPropertyDefinition, AppSchema } from "@ryot/app-backend/schema";

import { assertPresent, requirePresent } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";
import { createTracker, listTrackers } from "./trackers";

export type { AppPropertyDefinition, AppSchema };

type EnqueueEntitySearchBody = ContractPayload<"entitySchemas", "search">;

type EnqueueEntityImportBody = ContractPayload<"entities", "import">;

export interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	trackerId: string;
	accentColor?: string;
	propertiesSchema?: AppSchema;
}

export async function createEntitySchema(client: Client, options: CreateEntitySchemaOptions) {
	const {
		trackerId,
		icon = "book",
		name = "Test Schema",
		accentColor = "#00FF00",
		slug = `schema-${crypto.randomUUID()}`,
		propertiesSchema = {
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		},
	} = options;

	const schema = await client.run((c) =>
		c.entitySchemas.create({
			payload: {
				icon,
				name,
				slug,
				trackerId,
				accentColor,
				propertiesSchema,
			},
		}),
	);

	return {
		schemaId: requirePresent(schema.id, `Failed to create entity schema '${name}'`),
		slug: requirePresent(schema.slug, `Failed to create entity schema '${name}'`),
		data: schema,
	};
}

export async function listEntitySchemas(
	client: Client,
	options: { slugs?: string[]; trackerId?: string },
) {
	return client.run((c) => c.entitySchemas.list({ payload: options }));
}

export async function getEntitySchema(client: Client, entitySchemaId: string) {
	return client.run((c) => c.entitySchemas.get({ path: { entitySchemaId } }));
}

export async function findBuiltinEntitySchema(client: Client) {
	const { schemas, builtinTracker } = await listBuiltinEntitySchemas(client);
	const firstSchema = schemas[0];

	return { builtinTracker, schema: requirePresent(firstSchema, "No built-in entity schema found") };
}

export async function findBuiltinSchemaBySlug(client: Client, slug: string) {
	const trackers = await listTrackers(client, {
		includeDisabled: true,
	});
	const builtinTrackers = trackers.filter((tracker) => tracker.isBuiltin);
	const schemasByTracker = await Promise.all(
		builtinTrackers.map(async (builtinTracker) => {
			const schemas = await listEntitySchemas(client, {
				slugs: [slug],
				trackerId: builtinTracker.id,
			});

			return { builtinTracker, schema: schemas[0] };
		}),
	);

	for (const result of schemasByTracker) {
		if (result.schema) {
			return { schema: result.schema, builtinTracker: result.builtinTracker };
		}
	}

	throw new Error(`Built-in entity schema '${slug}' not found`);
}

export async function listBuiltinEntitySchemas(client: Client) {
	const trackers = await listTrackers(client, {
		includeDisabled: true,
	});
	const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
	assertPresent(builtinTracker, "Built-in tracker not found");
	const schemas = await listEntitySchemas(client, {
		trackerId: builtinTracker.id,
	});
	return { schemas, builtinTracker };
}

export async function findBuiltinSchemaWithProviders(client: Client) {
	return findBuiltinSchemaBySlug(client, "book");
}

export async function enqueueEntitySearch(client: Client, body: EnqueueEntitySearchBody) {
	const result = await client.run((c) => c.entitySchemas.search({ payload: body }));

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue entity search"),
	};
}

export async function pollEntitySearchResult(
	client: Client,
	jobId: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`entity search job '${jobId}'`,
		async () => {
			const result = await client.run((c) => c.entitySchemas.getSearchResult({ path: { jobId } }));
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}

export async function enqueueEntityImport(client: Client, body: EnqueueEntityImportBody) {
	const result = await client.run((c) => c.entities.import({ payload: body }));

	return {
		jobId: requirePresent(result.jobId, "Failed to enqueue entity import"),
	};
}

export async function pollEntityImportResult(
	client: Client,
	jobId: string,
	options: PollOptions = {},
) {
	return pollUntil(
		`entity import job '${jobId}'`,
		async () => {
			const result = await client.run((c) => c.entities.getImportResult({ path: { jobId } }));
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}

export function getFirstProviderScriptId(schema: {
	providers: ReadonlyArray<{ scriptId: string }>;
}) {
	const scriptId = schema.providers[0]?.scriptId;
	return requirePresent(scriptId, "No provider found for schema");
}

export async function createTrackerWithSchema(
	client: Client,
	options: Partial<Omit<CreateEntitySchemaOptions, "trackerId">> = {},
) {
	const { trackerId } = await createTracker(client);
	const { schemaId } = await createEntitySchema(client, {
		...options,
		trackerId,
	});
	return { schemaId };
}
