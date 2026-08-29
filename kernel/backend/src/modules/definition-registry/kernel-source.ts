import { column, literal, table } from "@ryot-app/ryotql";
import {
	buildSavedViewLayoutProjections,
	savedViewRecipe,
} from "@ryot-app/ryotql-recipes/saved-views";

import { manifest as notificationManifest } from "./kernel-scripts/notification.sandbox";
import type { DefinitionSource } from "./service";

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
			validation: { maximum: 100, minimum: 0 },
			description: "Your personal rating from 0 (lowest) to 100 (highest)",
		},
	},
};

const collectionSchema = {
	icon: "folders",
	pluginSlug: null,
	slug: "collection",
	name: "Collection",
	eventSchemas: [
		{ name: "Review", slug: "review", propertiesSchema: reviewPropertiesSchema },
		...(["Add", "Remove"] as const).map((operation) => ({
			name: `${operation} Entity ${operation === "Add" ? "to" : "from"} Collection`,
			slug: `${operation.toLowerCase()}-entity-${operation === "Add" ? "to" : "from"}-collection`,
			propertiesSchema: {
				fields: {
					entityId: {
						label: "Entity ID",
						type: "string" as const,
						validation: { required: true as const },
						reference: { kind: "entity-id" as const },
						description: `ID of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
					},
					entitySchemaSlug: {
						type: "string" as const,
						label: "Entity Schema Slug",
						validation: { required: true as const },
						description: `Schema slug of the entity ${operation === "Add" ? "added to" : "removed from"} the collection`,
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
				},
			},
		})),
	],
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
};

const collection = table("entity", "entity");
const collectionProjections = buildSavedViewLayoutProjections({
	table: {
		image: null,
		entity: collection,
		columns: [{ label: "Name", displayKind: "text", expression: column(collection, "name") }],
	},
	grid: {
		entity: collection,
		card: {
			image: null,
			callout: null,
			primaryMetadata: null,
			secondaryMetadata: null,
			overline: { displayKind: "text", expression: literal(collectionSchema.name) },
			title: column(collection, "name"),
		},
	},
	list: {
		entity: collection,
		card: {
			image: null,
			callout: null,
			primaryMetadata: null,
			secondaryMetadata: null,
			overline: { displayKind: "text", expression: literal(collectionSchema.name) },
			title: column(collection, "name"),
		},
	},
});

const collectionLayouts = {
	grid: {
		...collectionProjections.grid.mappings,
		queryDocument: savedViewRecipe({
			layout: { type: "card", mapping: collectionProjections.grid.mappings },
			source: {
				type: "generated",
				entitySchemaSlugs: ["collection"],
				fields: collectionProjections.grid.fields,
			},
		}).document,
	},
	list: {
		...collectionProjections.list.mappings,
		queryDocument: savedViewRecipe({
			layout: { type: "card", mapping: collectionProjections.list.mappings },
			source: {
				type: "generated",
				entitySchemaSlugs: ["collection"],
				fields: collectionProjections.list.fields,
			},
		}).document,
	},
	table: {
		...collectionProjections.table.mappings,
		queryDocument: savedViewRecipe({
			layout: { type: "table", mapping: collectionProjections.table.mappings },
			source: {
				type: "generated",
				entitySchemaSlugs: ["collection"],
				fields: collectionProjections.table.fields,
			},
		}).document,
	},
};

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
			notificationScriptSlug: "automation.notification",
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
			entitySchemaSlug: null,
			name: "All Collections",
			layouts: collectionLayouts,
			icon: collectionSchema.icon,
		},
	],
});

export const kernelScripts = [
	{
		...notificationManifest,
		entry: "src/modules/definition-registry/kernel-scripts/notification.sandbox.ts",
	},
] as const;
