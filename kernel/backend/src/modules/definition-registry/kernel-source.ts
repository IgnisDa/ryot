import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import { column, field, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import { manifest as notificationManifest } from "./kernel-scripts/notification.sandbox";
import type { DefinitionSource } from "./service";

export const kernelNotificationHook = {
	stage: "after",
	delivery: "async",
	name: "Signal Notification",
	slug: "automation.notification",
	scriptSlug: notificationManifest.slug,
	targets: [{ operation: "emit", resource: "signal", signalSchemaSlug: "integration.disabled" }],
} as const satisfies PluginHook;

const reviewPropertiesSchema = {
	fields: {
		text: {
			label: "Review",
			type: "string" as const,
			description: "Your written thoughts or notes about this entity",
		},
		isSpoiler: {
			label: "Is Spoiler?",
			type: "boolean" as const,
			description: "Whether this review contains spoilers",
		},
		rating: {
			label: "Rating",
			type: "number" as const,
			validation: { minimum: 0, maximum: 100 },
			description: "Your personal rating from 0 (lowest) to 100 (highest)",
		},
	},
};

const collectionSchema = {
	icon: "folders",
	pluginSlug: null,
	slug: "collection",
	name: "Collection",
	propertiesSchema: {
		fields: {
			description: {
				label: "Description",
				type: "string" as const,
				description: "A short summary or description of this collection",
			},
			membershipPropertiesSchema: {
				properties: {},
				type: "object" as const,
				unknownKeys: "passthrough" as const,
				label: "Membership Properties Schema",
				description:
					"JSON object schema defining extra properties attached to each collection member",
			},
		},
	},
	eventSchemas: [
		{ name: "Review", slug: "review", propertiesSchema: reviewPropertiesSchema },
		...(["Add", "Remove"] as const).map((operation) => ({
			name: `${operation} Entity ${operation === "Add" ? "to" : "from"} Collection`,
			slug: `${operation.toLowerCase()}-entity-${operation === "Add" ? "to" : "from"}-collection`,
			propertiesSchema: {
				fields: {
					entitySchemaSlug: {
						type: "string" as const,
						label: "Entity Schema Slug",
						validation: { required: true as const },
						description: `Schema slug of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
					},
					entityId: {
						label: "Entity ID",
						type: "string" as const,
						validation: { required: true as const },
						reference: { kind: "entity-id" as const },
						description: `ID of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
					},
					relationshipProperties: {
						properties: {},
						type: "object" as const,
						label: "Relationship Properties",
						unknownKeys: "passthrough" as const,
						description:
							operation === "Add"
								? "Properties of the membership relationship"
								: "Properties of the deleted membership relationship",
					},
					relationshipId: {
						type: "string" as const,
						label: "Relationship ID",
						validation: { required: true as const },
						reference: { kind: "relationship-id" as const },
						description:
							operation === "Add"
								? "ID of the membership relationship"
								: "ID of the membership relationship that was deleted",
					},
				},
			},
		})),
	],
};

const collection = table("entity", "entity");
const collectionProjections = buildSavedViewLayoutProjections({
	table: {
		image: null,
		entity: collection,
		columns: [{ label: "Name", displayKind: "text", expression: column(collection, "name") }],
	},
});

const collectionDataSources = savedViewRecipe({
	layout: { type: "table", mapping: collectionProjections.table.mappings },
	source: {
		type: "generated",
		entitySchemaSlugs: ["collection"],
		fields: [
			...collectionProjections.table.fields,
			field("ownerPluginId", column(collection, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(collection, "entitySchemaSlug")),
		],
	},
}).document;

export const kernelDefinitionSource = (): DefinitionSource => ({
	entitySchemas: [collectionSchema],
	relationshipSchemas: [
		{
			slug: "member-of",
			name: "Member Of",
			sourceEntitySchemaSlug: null,
			targetEntitySchemaSlug: "collection",
			propertiesSchema: {
				unknownKeys: "passthrough",
				fields: {
					rank: {
						label: "Rank",
						type: "number",
						defaultValue: 0,
						description: "Sort order of this entity within the collection",
					},
				},
			},
		},
	],
	signalSchemas: [
		{
			catalogState: "active",
			slug: "integration.disabled",
			name: "Integration Disabled",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: kernelNotificationHook.slug,
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					integrationId: {
						type: "string",
						label: "Integration ID",
						validation: { required: true },
						description: "Disabled integration ID",
					},
					providerName: {
						type: "string",
						label: "Provider name",
						validation: { required: true },
						description: "Disabled integration provider",
					},
				},
			},
		},
	],
	savedViews: [
		{
			sortOrder: 0,
			pluginSlug: null,
			slug: "collections",
			name: "All Collections",
			icon: collectionSchema.icon,
			dataSources: collectionDataSources,
			renderer: { kind: "kernel", name: "entity-browser" },
			settings: {
				pageSize: 20,
				addAction: null,
				sortChoices: [],
				defaultLayout: "grid",
				sourceName: "savedView",
				entityIdField: "entityId",
				searchFields: ["column0"],
				layouts: ["grid", "list", "table"],
				ownerPluginIdField: "ownerPluginId",
				entitySchemaSlugField: "entitySchemaSlug",
				tableColumns: collectionProjections.table.mappings.columns,
			},
		},
	],
});

export const kernelScripts = [
	{
		...notificationManifest,
		entry: "src/modules/definition-registry/kernel-scripts/notification.sandbox.ts",
	},
] as const;
