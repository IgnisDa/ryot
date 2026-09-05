import { SignalCatalogState } from "@ryot-app/contract/modules/automations/schemas";
import {
	PluginEntityUserStatePolicy,
	PluginSignalAudiencePolicy,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginSlug,
	RelationshipSchemaSlug,
	SandboxProviderId,
	SignalSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	ascending,
	column,
	defineRecipe,
	eq,
	literal,
	selectedField,
	selectedInclude,
	selectedRows,
	table,
	type Recipe,
} from "@ryot-app/ryotql";
import { Result, Schema } from "effect";

const entity = table("entitySchema", "entity");
const event = table("eventSchema", "event");
const provider = table("sandboxProvider", "provider");
const relationship = table("relationshipSchema", "relationship");
const signal = table("signalSchema", "signal");

export const entityDefinitionsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ entities }) => Result.succeed(entities),
		queries: {
			entities: selectedRows(entity, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(entity, "slug")), ascending(column(entity, "id"))],
				selection: {
					id: selectedField(column(entity, "id"), Schema.String),
					name: selectedField(column(entity, "name"), Schema.String),
					icon: selectedField(column(entity, "icon"), Schema.String),
					slug: selectedField(column(entity, "slug"), EntitySchemaSlug),
					propertiesSchema: selectedField(column(entity, "propertiesSchema"), AppSchema),
					pluginId: selectedField(column(entity, "pluginId"), Schema.NullOr(Schema.String)),
					pluginSlug: selectedField(column(entity, "pluginSlug"), Schema.NullOr(PluginSlug)),
					userState: selectedField(
						column(entity, "userState"),
						Schema.NullOr(PluginEntityUserStatePolicy),
					),
					mergeIdentityProperties: selectedField(
						column(entity, "mergeIdentityProperties"),
						Schema.Array(Schema.String),
					),
				},
				include: {
					providers: selectedInclude(provider, {
						limit: 100,
						where: eq(column(provider, "rootEntitySchemaSlug"), column(entity, "slug")),
						orderBy: [ascending(column(provider, "name")), ascending(column(provider, "id"))],
						selection: {
							name: selectedField(column(provider, "name"), Schema.String),
							providerId: selectedField(column(provider, "id"), SandboxProviderId),
						},
					}),
					eventSchemas: selectedInclude(event, {
						limit: 100,
						where: eq(column(event, "entitySchemaSlug"), column(entity, "slug")),
						orderBy: [ascending(column(event, "slug")), ascending(column(event, "id"))],
						selection: {
							name: selectedField(column(event, "name"), Schema.String),
							slug: selectedField(column(event, "slug"), EventSchemaSlug),
							propertiesSchema: selectedField(column(event, "propertiesSchema"), AppSchema),
						},
					}),
				},
			}),
		},
	}),
);

export const relationshipDefinitionsRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ relationships }) => Result.succeed(relationships),
		queries: {
			relationships: selectedRows(relationship, {
				after: input.after,
				limit: input.limit,
				orderBy: [ascending(column(relationship, "slug")), ascending(column(relationship, "id"))],
				selection: {
					id: selectedField(column(relationship, "id"), Schema.String),
					name: selectedField(column(relationship, "name"), Schema.String),
					slug: selectedField(column(relationship, "slug"), RelationshipSchemaSlug),
					propertiesSchema: selectedField(column(relationship, "propertiesSchema"), AppSchema),
					pluginId: selectedField(column(relationship, "pluginId"), Schema.NullOr(Schema.String)),
					pluginSlug: selectedField(column(relationship, "pluginSlug"), Schema.NullOr(PluginSlug)),
					sourceEntitySchemaSlug: selectedField(
						column(relationship, "sourceEntitySchemaSlug"),
						Schema.NullOr(EntitySchemaSlug),
					),
					targetEntitySchemaSlug: selectedField(
						column(relationship, "targetEntitySchemaSlug"),
						Schema.NullOr(EntitySchemaSlug),
					),
				},
			}),
		},
	}),
);

export const activeSignalSchemasRecipe = defineRecipe(
	(input: { readonly after?: string; readonly limit: number }) => ({
		map: ({ signals }) => Result.succeed(signals),
		queries: {
			signals: selectedRows(signal, {
				after: input.after,
				limit: input.limit,
				where: eq(column(signal, "catalogState"), literal("active")),
				orderBy: [ascending(column(signal, "slug")), ascending(column(signal, "id"))],
				selection: {
					id: selectedField(column(signal, "id"), Schema.String),
					name: selectedField(column(signal, "name"), Schema.String),
					slug: selectedField(column(signal, "slug"), SignalSchemaSlug),
					propertiesSchema: selectedField(column(signal, "propertiesSchema"), AppSchema),
					catalogState: selectedField(column(signal, "catalogState"), SignalCatalogState),
					pluginId: selectedField(column(signal, "pluginId"), Schema.NullOr(Schema.String)),
					pluginSlug: selectedField(column(signal, "pluginSlug"), Schema.NullOr(PluginSlug)),
					audiencePolicy: selectedField(
						column(signal, "audiencePolicy"),
						PluginSignalAudiencePolicy,
					),
				},
			}),
		},
	}),
);

export type EntityDefinitionsPage = Recipe.Success<typeof entityDefinitionsRecipe>;
export type RelationshipDefinitionsPage = Recipe.Success<typeof relationshipDefinitionsRecipe>;
export type ActiveSignalSchemasPage = Recipe.Success<typeof activeSignalSchemasRecipe>;
