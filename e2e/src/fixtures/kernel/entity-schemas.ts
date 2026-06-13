import type { ContractPayload } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	PluginSlug,
	type SandboxProviderId,
	type SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Brand, Effect } from "effect";

import { assertPresent, requirePresent } from "~/support/assertions";

import { adminHeaders } from "./admin";
import type { Client } from "./auth";
import { getApiClient } from "./contract-client";
import { createPluginScope, listInstalledPlugins } from "./plugins";
import { pollUntil } from "./polling";
import { installTestDefinitions } from "./test-plugin";

type SearchProviderEntitiesBody = ContractPayload<"providerEntities", "search">;
type ImportProviderEntityBody = ContractPayload<"providerEntities", "import">;
type EntitySchemaInputSlug = ContractPayload<"entities", "create">["entitySchemaSlug"];
type PluginEntitySchema = PluginManifest["entitySchemas"][number];

export const makeEntitySchemaSlug = Brand.nominal<EntitySchemaInputSlug>();
type CreateEntitySchemaOptions = Partial<
	Pick<PluginEntitySchema, "icon" | "name" | "slug" | "propertiesSchema">
> & {
	pluginSlug: PluginManifest["metadata"]["slug"];
};

export const createEntitySchema = (client: Client, options: CreateEntitySchemaOptions) =>
	Effect.gen(function* () {
		const {
			pluginSlug,
			icon = "book",
			name = "Test Schema",
			slug = `schema-${crypto.randomUUID()}`,
			propertiesSchema = {
				fields: { title: { label: "Title", description: "Title", type: "string" as const } },
			},
		} = options;
		const schema = {
			icon,
			name,
			slug,
			propertiesSchema,
			eventSchemas: [],
		};
		yield* installTestDefinitions({ client, pluginSlug, entitySchemas: [schema] });
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
			getApiClient().call((c) => c.testSupport.listSandboxScripts({ query: {} }), adminHeaders),
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

export const findBuiltinSchemaBySlug = (client: Client, slug: string) =>
	Effect.gen(function* () {
		const schemas = yield* listEntitySchemas(client, { slugs: [slug] });
		const schema = schemas.find((candidate) => candidate.pluginSlug == null);
		if (schema) {
			return { schema, builtinPlugin: null };
		}
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });

		for (const builtinPlugin of plugins) {
			const pluginSchema = schemas.find((candidate) => candidate.pluginSlug === builtinPlugin.slug);
			if (pluginSchema) {
				return { builtinPlugin, schema: pluginSchema };
			}
		}

		throw new Error(`Built-in entity schema '${slug}' not found`);
	});

export const getBuiltinEntitySchemaSlug = (slug: string) =>
	Effect.gen(function* () {
		const result = yield* getApiClient().call(
			(c) => c.testSupport.getBuiltinEntitySchema({ params: { slug } }),
			adminHeaders,
		);
		assertPresent(result, `Expected builtin entity schema '${slug}'`);
		return result.id;
	});

export const listBuiltinEntitySchemas = (client: Client) =>
	Effect.gen(function* () {
		const plugins = yield* listInstalledPlugins(client, { includeDisabled: true });
		const builtinPlugin = plugins[0];
		assertPresent(builtinPlugin, "Built-in plugin not found");
		const schemas = yield* listEntitySchemas(client, {
			pluginSlug: builtinPlugin.slug,
		});
		return { schemas, builtinPlugin };
	});

export const searchProviderEntities = (client: Client, body: SearchProviderEntitiesBody) =>
	client.call((c) => c.providerEntities.search({ payload: body }));

export const enqueueProviderEntityImport = (client: Client, body: ImportProviderEntityBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.providerEntities.import({ payload: body }));

		return { jobId: requirePresent(result.jobId, "Failed to enqueue entity import") };
	});

export const pollProviderEntityImportResult = (client: Client, jobId: string) =>
	pollUntil(
		`entity import job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* client.call((c) =>
				c.providerEntities.getImportResult({ params: { jobId } }),
			);
			return result.status !== "pending" ? result : null;
		}),
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
