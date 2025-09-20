import type { AppPropertyDefinition, AppSchema } from "@ryot/ts-utils/app-schema";

import { assertPresent, requirePresent, requireResponseData } from "../test-support/assertions";
import type { Client } from "./auth";
import type { ClientBody } from "./backend-client";
import { type PollOptions, pollUntil } from "./polling";
import { createTracker, listTrackers } from "./trackers";

export type { AppPropertyDefinition, AppSchema };

type EnqueueEntitySearchBody = ClientBody<"entity-schemas", "search">;

type EnqueueEntityImportBody = ClientBody<"entities", "import">;

type EntitySchemaRecord = {
	id: string;
	name: string;
	slug: string;
	icon: string;
	trackerId: string;
	accentColor: string;
	isBuiltin: boolean;
	propertiesSchema: AppSchema;
	providers: ReadonlyArray<{ name: string; scriptId: string }>;
};

// TODO(Task 11): Replace these tests-only entity schema assertions with the public
// AppContract types once propertiesSchema and providers are typed in the contract.
const toEntitySchemaRecord = (value: unknown) => value as EntitySchemaRecord;

// TODO(Task 11): Replace these tests-only entity schema assertions with the public
// AppContract types once propertiesSchema and providers are typed in the contract.
const toEntitySchemaRecords = (value: unknown) => value as readonly EntitySchemaRecord[];

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
			fields: { title: { label: "Title", description: "Title", type: "string" as const } },
		},
	} = options;

	const { data, response } = await client["entity-schemas"].create({
		headers: { Cookie: cookies },
		body: {
			icon,
			name,
			slug,
			trackerId,
			accentColor,
			propertiesSchema,
		},
	});

	const schema = toEntitySchemaRecord(
		requireResponseData(response, data, `Failed to create entity schema '${name}'`),
	);
	return {
		schemaId: requirePresent(schema.id, `Failed to create entity schema '${name}'`),
		slug: requirePresent(schema.slug, `Failed to create entity schema '${name}'`),
		data: schema,
	};
}

export async function listEntitySchemas(
	client: Client,
	cookies: string,
	options: { slugs?: string[]; trackerId?: string },
) {
	const { data, response } = await client["entity-schemas"].list({
		body: options,
		headers: { Cookie: cookies },
	});

	return toEntitySchemaRecords(
		requireResponseData(response, data, "Failed to list entity schemas"),
	);
}

export async function getEntitySchema(client: Client, cookies: string, entitySchemaId: string) {
	const { data, response } = await client["entity-schemas"].get({
		headers: { Cookie: cookies },
		params: { path: { entitySchemaId } },
	});

	return toEntitySchemaRecord(
		requireResponseData(response, data, `Failed to get entity schema '${entitySchemaId}'`),
	);
}

export async function findBuiltinEntitySchema(client: Client, cookies: string) {
	const { schemas, builtinTracker } = await listBuiltinEntitySchemas(client, cookies);
	const firstSchema = schemas[0];

	return { builtinTracker, schema: requirePresent(firstSchema, "No built-in entity schema found") };
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
	assertPresent(builtinTracker, "Built-in tracker not found");
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
	const { data, response } = await client["entity-schemas"].search({
		body,
		headers: { Cookie: cookies },
	});

	return {
		jobId: requirePresent(
			requireResponseData(response, data, "Failed to enqueue entity search").jobId,
			"Failed to enqueue entity search",
		),
	};
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
			const { data, response } = await client["entity-schemas"].getSearchResult({
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			const result = requireResponseData(
				response,
				data,
				`Failed to poll entity search result '${jobId}'`,
			);
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
	const { data, response } = await client.entities.import({
		body,
		headers: { Cookie: cookies },
	});

	return {
		jobId: requirePresent(
			requireResponseData(response, data, "Failed to enqueue entity import").jobId,
			"Failed to enqueue entity import",
		),
	};
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
			const { data, response } = await client.entities.getImportResult({
				params: { path: { jobId } },
				headers: { Cookie: cookies },
			});
			const result = requireResponseData(
				response,
				data,
				`Failed to poll entity import result '${jobId}'`,
			);
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
	cookies: string,
	options: Partial<Omit<CreateEntitySchemaOptions, "trackerId">> = {},
) {
	const { trackerId } = await createTracker(client, cookies);
	const { schemaId } = await createEntitySchema(client, cookies, {
		...options,
		trackerId,
	});
	return { schemaId };
}
