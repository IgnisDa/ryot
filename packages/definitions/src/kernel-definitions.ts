import { reviewPropertyFields } from "@ryot-app/contract/modules/events/review";
import {
	and,
	ascending,
	column,
	contains,
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
import { librarySearchQuery } from "@ryot-app/ryotql-recipes/library-search";
import { parameters } from "@ryot-app/ryotql/authoring";
import { Result } from "effect";

import { deriveSavedViewQueries } from "./saved-view-queries";
import type { DefinitionSource } from "./snapshot";

export const kernelNotificationHookSlug = "automation.notification";

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
		{
			pluginId: null,
			name: "Review",
			slug: "review",
			propertiesSchema: {
				fields: reviewPropertyFields("Your written thoughts or notes about this entity"),
			},
		},
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

const collectionParameters = parameters({
	fields: {
		searchText: {
			type: "string",
			label: "Search",
			defaultValue: "",
			description: "Collection name",
		},
	},
});
const collectionSettings = {
	pageSize: 20,
	addAction: null,
	defaultLayout: "grid",
	sourceName: "savedView",
	controls: { search: "searchText" },
	layouts: ["grid", "list", "table"],
	summary: { image: null, subtitle: null },
	subject: { entityAlias: "entity", schemas: [{ slug: "collection", owner: { kind: "kernel" } }] },
	tableColumns: [
		{ label: "Name", field: "name", displayKind: "text" },
		{ label: "Items", field: "memberCount", displayKind: "number" },
	],
} as const;
const collectionQuery = rows(collection, {
	orderBy: [ascending(column(collection, "name"))],
	where: and(
		entitySchemaPredicate(collection, "collection", { kind: "kernel" }),
		contains(column(collection, "name"), collectionParameters.value("searchText")),
	),
	fields: [
		field("entityId", column(collection, "id")),
		field("name", column(collection, "name")),
		field(
			"memberCount",
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
});
const collectionDataSources = Result.getOrThrow(
	deriveSavedViewQueries({ kind: "kernel", name: "collection-browser" }, collectionSettings, {
		parameters: collectionParameters.schema,
		...document({
			savedView: collectionQuery,
			librarySearch: librarySearchQuery({
				entity: collection,
				source: collectionQuery,
				searchExpressions: [column(collection, "name")],
				search: collectionParameters.value("searchText"),
			}).document,
		}),
	}),
);

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
			settings: collectionSettings,
			dataSources: collectionDataSources,
			renderer: { kind: "kernel", name: "collection-browser" },
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
		{
			sortOrder: 2,
			settings: {},
			pluginId: null,
			slug: "analytics",
			name: "Analytics",
			dataSources: null,
			icon: "chart-column",
			renderer: { kind: "kernel", name: "analytics" },
		},
	],

	signalSchemas: [
		{
			pluginId: null,
			slug: "reminder.due",
			name: "Reminder due",
			catalogState: "active",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: kernelNotificationHookSlug,
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					message: {
						type: "string",
						label: "Message",
						validation: { required: true },
						description: "Authored reminder text",
					},
					timezone: {
						type: "string",
						label: "Timezone",
						validation: { required: true },
						description: "Selected IANA timezone",
					},
					dueAt: {
						type: "string",
						label: "Scheduled time",
						validation: { required: true },
						description: "Fixed UTC due instant",
					},
					entityTitle: {
						type: "string",
						label: "Entity",
						validation: { required: true },
						description: "Target title at scheduling",
					},
					reminderId: {
						type: "string",
						label: "Reminder ID",
						validation: { required: true },
						description: "Independent reminder occurrence",
					},
				},
			},
		},
		{
			pluginId: null,
			catalogState: "active",
			slug: "integration.disabled",
			name: "Integration Disabled",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: kernelNotificationHookSlug,
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
