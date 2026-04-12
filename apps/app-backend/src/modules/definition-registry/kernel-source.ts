import { column, literal, table } from "@ryot/ryotql";
import { buildAllCollectionsDocument } from "@ryot/ryotql-recipes/collections";
import { buildSavedViewLayoutProjections } from "@ryot/ryotql-recipes/saved-views";

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

const collection = table("entity", "collection");
const collectionProjections = buildSavedViewLayoutProjections({
	table: {
		image: null,
		entityId: column(collection, "id"),
		columns: [{ label: "Name", expression: column(collection, "name") }],
	},
	grid: {
		entityId: column(collection, "id"),
		card: {
			image: null,
			callout: null,
			primaryMetadata: null,
			secondaryMetadata: null,
			overline: literal(collectionSchema.name),
			title: column(collection, "name"),
		},
	},
	list: {
		entityId: column(collection, "id"),
		card: {
			image: null,
			callout: null,
			primaryMetadata: null,
			secondaryMetadata: null,
			overline: literal(collectionSchema.name),
			title: column(collection, "name"),
		},
	},
});

const collectionLayouts = {
	grid: {
		...collectionProjections.grid.mappings,
		queryDocument: buildAllCollectionsDocument({ fields: collectionProjections.grid.fields }),
	},
	list: {
		...collectionProjections.list.mappings,
		queryDocument: buildAllCollectionsDocument({ fields: collectionProjections.list.fields }),
	},
	table: {
		...collectionProjections.table.mappings,
		queryDocument: buildAllCollectionsDocument({ fields: collectionProjections.table.fields }),
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
