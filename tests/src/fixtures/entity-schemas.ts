import type { ContractPayload } from "@ryot/contract/client";
import {
	PluginSlug,
	type SandboxProviderId,
	type SandboxScriptId,
	UserId,
} from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Brand, Effect } from "effect";

import { assertPresent, requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getBackendClient } from "./contract-client";
import { createPluginScope, listPluginWorkspaces } from "./plugin-workspaces";
import { type PollOptions, pollUntil } from "./polling";
import { installTestDefinitions } from "./test-plugin";

type EnqueueEntitySearchBody = Omit<
	ContractPayload<"testSupport", "enqueueSandbox">,
	"executingUserId"
>;

type EnqueueEntityImportBody = ContractPayload<"entityImport", "import">;
type EntitySchemaInputSlug = ContractPayload<"entities", "create">["entitySchemaSlug"];

export const makeEntitySchemaSlug = Brand.nominal<EntitySchemaInputSlug>();
export interface CreateEntitySchemaOptions {
	icon?: string;
	name?: string;
	slug?: string;
	pluginSlug: string;
	accentColor?: string;
	propertiesSchema?: AppSchema;
}

export const createEntitySchema = (_client: Client, options: CreateEntitySchemaOptions) =>
	Effect.gen(function* () {
		const {
			pluginSlug,
			icon = "book",
			name = "Test Schema",
			accentColor = "#00FF00",
			slug = `schema-${crypto.randomUUID()}`,
			propertiesSchema = {
				fields: { title: { label: "Title", description: "Title", type: "string" as const } },
			},
		} = options;
		const schema = {
			icon,
			name,
			slug,
			accentColor,
			propertiesSchema,
			eventSchemas: [],
		};
		yield* installTestDefinitions({ pluginSlug, entitySchemas: [schema] });
		const schemaSlug = makeEntitySchemaSlug(slug);
		return {
			slug: schemaSlug,
			schemaId: schemaSlug,
			data: { ...schema, id: schemaSlug, pluginSlug: PluginSlug.make(pluginSlug) },
		};
	});

export const listEntitySchemas = (
	client: Client,
	options: { slugs?: string[]; pluginSlug?: string },
) =>
	Effect.gen(function* () {
		const [schemas, scripts] = yield* Effect.all([
			client.call((c) => c.definitions.listEntities({})),
			getBackendClient().call(
				(c) => c.testSupport.listSandboxScripts({ urlParams: {} }),
				adminHeaders,
			),
		]);
		const providers = new Map<
			string,
			{
				name: string;
				providerId: SandboxProviderId;
				providerSlug: string;
				detailsScriptId?: SandboxScriptId;
				searchScriptId?: SandboxScriptId;
				resolveScriptId?: SandboxScriptId;
				translateScriptId?: SandboxScriptId;
			}
		>();
		const providerOperationNames = ["details", "search", "resolve", "translate"] as const;
		for (const script of scripts) {
			const providerOperation = providerOperationNames.find((operation) =>
				script.slug.endsWith(`.${operation}`),
			);
			if (!script.providerId || !providerOperation) {
				continue;
			}
			const providerSlug = script.slug.slice(0, -(providerOperation.length + 1));
			const provider = providers.get(providerSlug) ?? {
				name: script.name,
				providerSlug,
				providerId: script.providerId,
			};
			provider[`${providerOperation}ScriptId`] = script.id;
			providers.set(providerSlug, provider);
		}
		return schemas
			.filter((schema) => !options.slugs || options.slugs.includes(schema.slug))
			.filter((schema) => !options.pluginSlug || schema.pluginSlug === options.pluginSlug)
			.map((schema) =>
				Object.assign({}, schema, {
					id: makeEntitySchemaSlug(schema.slug),
					providers: [...providers.values()]
						.filter((provider) => provider.providerSlug.startsWith(`${schema.slug}.`))
						.map((provider) =>
							Object.assign({}, provider, {
								name:
									schema.providers.find(({ providerId }) => providerId === provider.providerId)
										?.name ?? provider.name,
							}),
						),
					isBuiltin: true,
					pluginSlug: schema.pluginSlug ?? undefined,
				}),
			);
	});

export const getEntitySchema = (client: Client, entitySchemaSlug: string) =>
	Effect.gen(function* () {
		const schemas = yield* listEntitySchemas(client, { slugs: [entitySchemaSlug] });
		return requirePresent(schemas[0], `Entity schema '${entitySchemaSlug}' not found`);
	});

export const findBuiltinEntitySchema = (client: Client) =>
	Effect.gen(function* () {
		const { schemas, builtinWorkspace } = yield* listBuiltinEntitySchemas(client);
		const firstSchema = schemas[0];

		return {
			builtinWorkspace,
			schema: requirePresent(firstSchema, "No built-in entity schema found"),
		};
	});

export const findBuiltinSchemaBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const [schema] = yield* listEntitySchemas(client, { slugs: [slug] });
		if (schema && schema.pluginSlug == null) {
			return { schema, builtinWorkspace: null };
		}
		const workspaces = yield* listPluginWorkspaces(client, {
			includeDisabled: true,
		});
		const schemasByWorkspace = yield* Effect.all(
			workspaces.map((builtinWorkspace) =>
				Effect.gen(function* () {
					const schemas = yield* listEntitySchemas(client, {
						slugs: [slug],
						pluginSlug: builtinWorkspace.slug,
					});

					return { builtinWorkspace, schema: schemas[0] };
				}),
			),
		);

		for (const result of schemasByWorkspace) {
			if (result.schema) {
				return { schema: result.schema, builtinWorkspace: result.builtinWorkspace };
			}
		}

		throw new Error(`Built-in entity schema '${slug}' not found`);
	});

export const getBuiltinEntitySchemaSlug = (slug: string) =>
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
		const workspaces = yield* listPluginWorkspaces(client, {
			includeDisabled: true,
		});
		const builtinWorkspace = workspaces[0];
		assertPresent(builtinWorkspace, "Built-in plugin workspace not found");
		const schemas = yield* listEntitySchemas(client, {
			pluginSlug: builtinWorkspace.slug,
		});
		return { schemas, builtinWorkspace };
	});

export const findBuiltinSchemaWithProviders = (client: Client) =>
	findBuiltinSchemaBySlug(client, "book");

export const enqueueEntitySearch = (executingUserId: string, body: EnqueueEntitySearchBody) =>
	Effect.gen(function* () {
		const result = yield* getBackendClient().call(
			(c) =>
				c.testSupport.enqueueSandbox({
					payload: { ...body, executingUserId: UserId.make(executingUserId) },
				}),
			adminHeaders,
		);

		return {
			jobId: requirePresent(result.jobId, "Failed to enqueue entity search"),
		};
	});

export const pollEntitySearchResult = (
	executingUserId: string,
	jobId: string,
	options: PollOptions = {},
) =>
	pollUntil(
		`entity search job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* getBackendClient().call(
				(c) =>
					c.testSupport.getSandboxResult({
						path: { jobId },
						urlParams: { executingUserId: UserId.make(executingUserId) },
					}),
				adminHeaders,
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

export function getFirstProviderSearchScriptId(schema: {
	providers: ReadonlyArray<{ searchScriptId?: SandboxScriptId }>;
}) {
	return requirePresent(
		schema.providers[0]?.searchScriptId,
		"No searchable provider found for schema",
	);
}

export const createPluginSchema = (
	client: Client,
	options: Partial<Omit<CreateEntitySchemaOptions, "pluginSlug">> = {},
) =>
	Effect.gen(function* () {
		const pluginSlug = createPluginScope();
		const { slug, schemaId } = yield* createEntitySchema(client, { ...options, pluginSlug });
		return { slug, schemaId };
	});
