import type { ContractPayload } from "@ryot-app/contract/client";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionOwner,
	type DefinitionOwner,
	type PluginPackageReference,
} from "@ryot-app/contract/modules/plugins/references";
import type {
	PluginId,
	SandboxProviderId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { entityDefinitionsRecipe } from "@ryot-app/ryotql-recipes/definitions";
import { Brand, Effect } from "effect";

import { assertPresent, requirePresent } from "~/support/assertions";

import { listAdminSandboxScripts } from "./admin-sandbox-scripts";
import type { Client } from "./auth";
import {
	createPluginScope,
	findPluginInstallationByPackage,
	findPluginInstallationByPluginId,
} from "./plugins";
import { pollUntil } from "./polling";
import { collectRyotQLRecipeItems } from "./ryotql";
import { installTestDefinitions } from "./test-plugin";

type SearchProviderEntitiesBody = ContractPayload<"entityProviders", "search">;
type ImportProviderEntityBody = ContractPayload<"entityProviders", "import">;
type EntitySchemaInputSlug = ContractPayload<"entities", "create">["entitySchema"]["slug"];
type PluginEntitySchema = PluginManifest["entitySchemas"][number];

export const makeEntitySchemaSlug = Brand.nominal<EntitySchemaInputSlug>();
type CreateEntitySchemaOptions = Partial<
	Pick<PluginEntitySchema, "icon" | "name" | "slug" | "propertiesSchema">
> & { pluginSlug: string };

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
		const schema = { icon, name, slug, propertiesSchema, eventSchemas: [] };
		const installed = yield* installTestDefinitions({
			client,
			pluginSlug,
			entitySchemas: [schema],
		});
		const schemaSlug = makeEntitySchemaSlug(slug);
		return {
			slug: schemaSlug,
			schemaId: schemaSlug,
			pluginId: installed.pluginId,
			data: { ...schema, pluginSlug, id: schemaSlug },
			reference: { slug: schemaSlug, owner: definitionOwner(installed.pluginId) },
		};
	});

export const listEntitySchemas = (
	client: Client,
	options: { slugs?: string[]; pluginId?: PluginId },
) =>
	Effect.gen(function* () {
		const [schemas, scripts] = yield* Effect.all([
			collectRyotQLRecipeItems(client, (after) => entityDefinitionsRecipe({ after, limit: 100 })),
			listAdminSandboxScripts(),
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
			const provider = providers.get(script.providerId) ?? {
				providerSlug,
				name: script.name,
				providerId: script.providerId,
			};
			provider[`${providerOperation}ScriptId`] = script.id;
			providers.set(script.providerId, provider);
		}
		return schemas
			.filter((schema) => !options.slugs || options.slugs.includes(schema.slug))
			.filter((schema) => !options.pluginId || schema.pluginId === options.pluginId)
			.map((schema) =>
				Object.assign({}, schema, {
					isBuiltin: true,
					id: makeEntitySchemaSlug(schema.slug),
					reference: {
						owner: definitionOwner(schema.pluginId),
						slug: makeEntitySchemaSlug(schema.slug),
					},
					providers: schema.providers.items.map(({ name, providerId }) => ({
						...requirePresent(providers.get(providerId), "Provider scripts missing"),
						name,
					})),
				}),
			);
	});

export const getEntitySchema = (
	client: Client,
	reference: ContractPayload<"entities", "create">["entitySchema"],
) =>
	Effect.gen(function* () {
		const schemas = yield* listEntitySchemas(client, { slugs: [reference.slug] });
		const owner = reference.owner.kind === "kernel" ? null : reference.owner.pluginId;
		return requirePresent(
			schemas.find((schema) => schema.pluginId === owner),
			`Entity schema '${reference.slug}' not found`,
		);
	});

export const findBuiltinSchemaBySlug = (client: Client, slug: string, owner: DefinitionOwner) =>
	Effect.gen(function* () {
		const schema = yield* getEntitySchema(client, { owner, slug: makeEntitySchemaSlug(slug) });
		const builtinPlugin =
			owner.kind === "kernel"
				? null
				: yield* findPluginInstallationByPluginId(client, owner.pluginId);
		return { schema, builtinPlugin };
	});

export const getBuiltinEntitySchemaSlug = (client: Client, slug: string, owner: DefinitionOwner) =>
	Effect.gen(function* () {
		const schemas = yield* collectRyotQLRecipeItems(client, (after) =>
			entityDefinitionsRecipe({ after, limit: 100 }),
		);
		const pluginId = owner.kind === "kernel" ? null : owner.pluginId;
		const schema = schemas.find(
			(candidate) => candidate.slug === slug && candidate.pluginId === pluginId,
		);
		assertPresent(schema, `Expected builtin entity schema '${slug}'`);
		return makeEntitySchemaSlug(schema.slug);
	});

export const listBuiltinEntitySchemas = (
	client: Client,
	selection: PluginId | PluginPackageReference,
) =>
	Effect.gen(function* () {
		const builtinPlugin =
			typeof selection === "string"
				? yield* findPluginInstallationByPluginId(client, selection)
				: yield* findPluginInstallationByPackage(client, selection);
		const schemas = yield* listEntitySchemas(client, { pluginId: builtinPlugin.pluginId });
		return { schemas, builtinPlugin };
	});

export const searchProviderEntities = (client: Client, body: SearchProviderEntitiesBody) =>
	client.call((c) => c.entityProviders.search({ payload: body }));

export const enqueueProviderEntityImport = (client: Client, body: ImportProviderEntityBody) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) => c.entityProviders.import({ payload: body }));

		return { jobId: requirePresent(result.jobId, "Failed to enqueue entity import") };
	});

export const pollProviderEntityImportResult = (client: Client, jobId: string) =>
	pollUntil(
		`entity import job '${jobId}'`,
		Effect.gen(function* () {
			const result = yield* client.call((c) =>
				c.entityProviders.getImportResult({ params: { jobId } }),
			);
			return result.status === "queued" || result.status === "running" ? null : result;
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
		const schema = yield* createEntitySchema(client, { ...options, pluginSlug });
		return { ...schema, pluginSlug };
	});
