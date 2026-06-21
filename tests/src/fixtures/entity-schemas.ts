import { EntitySchemaId, SandboxScriptId, TrackerId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect } from "effect";

import { assertPresent, requirePresent } from "~/support/assertions";

export type { AppSchema };
import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { type ContractPayload, getBackendClient } from "./contract-client";
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

export const createEntitySchema = (client: Client, options: CreateEntitySchemaOptions) =>
	Effect.gen(function* () {
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

		const schema = yield* client.call((c) =>
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
	});

export const listEntitySchemas = (
	client: Client,
	options: { slugs?: string[]; trackerId?: string },
) =>
	client.call((c) =>
		c.entitySchemas.list({
			payload: {
				slugs: options.slugs,
				trackerId: options.trackerId ? TrackerId.make(options.trackerId) : undefined,
			},
		}),
	);

export const getEntitySchema = (client: Client, entitySchemaId: string) =>
	client.call((c) =>
		c.entitySchemas.get({ path: { entitySchemaId: EntitySchemaId.make(entitySchemaId) } }),
	);

export const findBuiltinEntitySchema = (client: Client) =>
	Effect.gen(function* () {
		const { schemas, builtinTracker } = yield* listBuiltinEntitySchemas(client);
		const firstSchema = schemas[0];

		return {
			builtinTracker,
			schema: requirePresent(firstSchema, "No built-in entity schema found"),
		};
	});

export const findBuiltinSchemaBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, {
			includeDisabled: true,
		});
		const builtinTrackers = trackers.filter((tracker) => tracker.isBuiltin);
		const schemasByTracker = yield* Effect.all(
			builtinTrackers.map((builtinTracker) =>
				Effect.gen(function* () {
					const schemas = yield* listEntitySchemas(client, {
						slugs: [slug],
						trackerId: builtinTracker.id,
					});

					return { builtinTracker, schema: schemas[0] };
				}),
			),
		);

		for (const result of schemasByTracker) {
			if (result.schema) {
				return { schema: result.schema, builtinTracker: result.builtinTracker };
			}
		}

		throw new Error(`Built-in entity schema '${slug}' not found`);
	});

export const getBuiltinEntitySchemaId = (slug: string) =>
	Effect.gen(function* () {
		const result = yield* getBackendClient().call(
			(c) => c.testSupport.getBuiltinEntitySchema({ path: { slug } }),
			adminHeaders,
		);
		assertPresent(result, `Expected builtin entity schema '${slug}'`);
		return result.id;
	});

export const listBuiltinEntitySchemas = (client: Client) =>
	Effect.gen(function* () {
		const trackers = yield* listTrackers(client, {
			includeDisabled: true,
		});
		const builtinTracker = trackers.find((tracker) => tracker.isBuiltin);
		assertPresent(builtinTracker, "Built-in tracker not found");
		const schemas = yield* listEntitySchemas(client, {
			trackerId: builtinTracker.id,
		});
		return { schemas, builtinTracker };
	});

export const findBuiltinSchemaWithProviders = (client: Client) =>
	findBuiltinSchemaBySlug(client, "book");

export const enqueueEntitySearch = (client: Client, body: EnqueueEntitySearchBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.entitySchemas.search({ payload: body }));

		return {
			jobId: requirePresent(result.jobId, "Failed to enqueue entity search"),
		};
	});

export const pollEntitySearchResult = (client: Client, jobId: string, options: PollOptions = {}) =>
	pollUntil(
		`entity search job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* client.call((c) =>
				c.entitySchemas.getSearchResult({ path: { jobId } }),
			);
			return result.status !== "pending" ? result : null;
		}),
		options,
	);

export const enqueueEntityImport = (client: Client, body: EnqueueEntityImportBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.entityImport.import({ payload: body }));

		return {
			jobId: requirePresent(result.jobId, "Failed to enqueue entity import"),
		};
	});

export const pollEntityImportResult = (client: Client, jobId: string, options: PollOptions = {}) =>
	pollUntil(
		`entity import job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* client.call((c) => c.entityImport.getImportResult({ path: { jobId } }));
			return result.status !== "pending" ? result : null;
		}),
		options,
	);

export function getFirstProviderScriptId(schema: {
	providers: ReadonlyArray<{ scriptId: string }>;
}) {
	const scriptId = schema.providers[0]?.scriptId;
	return SandboxScriptId.make(requirePresent(scriptId, "No provider found for schema"));
}

export const createTrackerWithSchema = (
	client: Client,
	options: Partial<Omit<CreateEntitySchemaOptions, "trackerId">> = {},
) =>
	Effect.gen(function* () {
		const { trackerId } = yield* createTracker(client);
		const { slug, schemaId } = yield* createEntitySchema(client, { ...options, trackerId });
		return { slug, schemaId };
	});
