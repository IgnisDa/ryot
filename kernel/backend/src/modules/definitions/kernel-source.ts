import type { PluginHook } from "@ryot-app/contract/modules/plugins/manifest";
import {
	and,
	ascending,
	column,
	countDistinct,
	document,
	entitySchemaPredicate,
	eq,
	field,
	literal,
	rows,
	schemaOwnerPredicate,
	table,
} from "@ryot-app/ryotql";

import { manifest as notificationManifest } from "./kernel-scripts/notification.sandbox";
import type { DefinitionSource } from "./snapshot";

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
			type: "boolean" as const,
			label: "Contains spoilers",
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
	pluginId: null,
	icon: "folders",
	slug: "collection",
	name: "Collection",
	propertiesSchema: {
		fields: {
			description: {
				label: "Description",
				type: "string" as const,
				description: "A short summary or description of this collection",
			},
			membershipFields: {
				type: "array" as const,
				label: "Membership Fields",
				description: "Ordered field declarations for collection members",
				items: {
					properties: {},
					label: "Field",
					type: "object" as const,
					unknownKeys: "passthrough" as const,
					description: "Collection member field declaration",
				},
			},
		},
	},
	eventSchemas: [
		{ pluginId: null, name: "Review", slug: "review", propertiesSchema: reviewPropertiesSchema },
		...(["Add", "Remove"] as const).map((operation) => ({
			pluginId: null,
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
const collectionMembership = table("relationship", "collectionMembership");

const collectionDataSources = document({
	savedView: rows(collection, {
		orderBy: [ascending(column(collection, "name"))],
		where: entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
		fields: [
			field("entityId", column(collection, "id")),
			field("name", column(collection, "name")),
			field(
				"presentationMemberCount",
				countDistinct(collectionMembership, column(collectionMembership, "sourceEntityId"), {
					where: and(
						schemaOwnerPredicate(collectionMembership, "relationshipSchemaPluginId", {
							kind: "kernel",
						}),
						eq(column(collectionMembership, "targetEntityId"), column(collection, "id")),
						eq(column(collectionMembership, "relationshipSchemaSlug"), literal("member-of")),
					),
				}),
			),
			field("ownerPluginId", column(collection, "entitySchemaPluginId")),
			field("entitySchemaSlug", column(collection, "entitySchemaSlug")),
		],
	}),
});

export const kernelDefinitionSource = (): DefinitionSource => ({
	calendarSources: [],
	entitySchemas: [collectionSchema],
	relationshipSchemas: [
		{
			pluginId: null,
			slug: "member-of",
			name: "Member Of",
			sourceEntitySchemaSlug: null,
			targetEntitySchemaSlug: "collection",
			propertiesSchema: {
				unknownKeys: "passthrough",
				fields: {
					rank: {
						label: "Rank",
						type: "integer",
						defaultValue: 0,
						description: "Sort order of this entity within the collection",
					},
				},
			},
		},
	],
	savedViews: [
		{
			sortOrder: 0,
			pluginId: null,
			slug: "collections",
			name: "All Collections",
			icon: collectionSchema.icon,
			dataSources: collectionDataSources,
			renderer: { kind: "kernel", name: "collection-browser" },
			settings: {
				pageSize: 20,
				addAction: null,
				sortChoices: [],
				defaultLayout: "grid",
				searchFields: ["name"],
				sourceName: "savedView",
				layouts: ["grid", "list", "table"],
				summary: { image: null, subtitle: null },
				tableColumns: [{ label: "Name", field: "name", displayKind: "text" }],
				subject: {
					entityAlias: "entity",
					schemas: [{ slug: "collection", owner: { kind: "kernel" } }],
				},
			},
		},
		{
			sortOrder: 1,
			settings: {},
			pluginId: null,
			slug: "calendar",
			name: "Calendar",
			icon: "calendar",
			dataSources: null,
			renderer: { kind: "kernel", name: "calendar" },
		},
	],

	signalSchemas: [
		{
			pluginId: null,
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
});

export const kernelScripts = [
	{
		...notificationManifest,
		entry: "src/modules/definitions/kernel-scripts/notification.sandbox.ts",
	},
] as const;
