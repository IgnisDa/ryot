import { EntitySchemaId, SandboxScriptId, TrackerId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";

import { getPgClient } from "../setup";
import { assertPresent, requirePresent } from "../test-support/assertions";

export type { AppSchema };
import type { Client } from "./auth";
import type { ContractPayload } from "./contract-client";
import { type PollOptions, pollUntil } from "./polling";
import { createTracker, listTrackers } from "./trackers";

type EnqueueEntitySearchBody = ContractPayload<"entitySchemas", "search">;

type EnqueueEntityImportBody = ContractPayload<"entityImport", "import">;

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
				accentColor,
				propertiesSchema,
				trackerId: TrackerId.make(trackerId),
			},
		}),
	);

	return {
		data: schema,
		slug: requirePresent(schema.slug, `Failed to create entity schema '${name}'`),
		schemaId: requirePresent(schema.id, `Failed to create entity schema '${name}'`),
	};
}

export async function listEntitySchemas(
	client: Client,
	options: { slugs?: string[]; trackerId?: string },
) {
	return client.run((c) =>
		c.entitySchemas.list({
			payload: {
				slugs: options.slugs,
				trackerId: options.trackerId ? TrackerId.make(options.trackerId) : undefined,
			},
		}),
	);
}

export async function getEntitySchema(client: Client, entitySchemaId: string) {
	return client.run((c) =>
		c.entitySchemas.get({ path: { entitySchemaId: EntitySchemaId.make(entitySchemaId) } }),
	);
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

// Structural sub-entity schemas (show-season, show-episode, podcast-episode) are
// global (user_id null) and not linked to any user tracker, so the tracker-scoped
// entity-schema list API cannot reach them. Look them up directly instead.
export const getBuiltinEntitySchemaId = async (slug: string) => {
	const result = await getPgClient().query<{ id: string }>(
		`select id from entity_schema where slug = $1 and user_id is null and is_builtin = true limit 1`,
		[slug],
	);
	const row = result.rows[0];
	assertPresent(row, `Expected builtin entity schema '${slug}'`);
	return row.id;
};

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
	const result = await client.run((c) => c.entityImport.import({ payload: body }));

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
			const result = await client.run((c) => c.entityImport.getImportResult({ path: { jobId } }));
			return result.status !== "pending" ? result : null;
		},
		options,
	);
}

export function getFirstProviderScriptId(schema: {
	providers: ReadonlyArray<{ scriptId: string }>;
}) {
	const scriptId = schema.providers[0]?.scriptId;
	return SandboxScriptId.make(requirePresent(scriptId, "No provider found for schema"));
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
