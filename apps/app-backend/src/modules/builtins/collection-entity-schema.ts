import type { AppSchema } from "@ryot/contract/schema/property-schema";

export const buildCollectionEntitySchema = (
	reviewPropertiesSchemaByEntity: (entitySchemaSlug: string | undefined) => AppSchema,
) => ({
	icon: "folders",
	slug: "collection",
	name: "Collection",
	trackerSlug: "media",
	accentColor: "#F59E0B",
	eventSchemas: [
		{
			name: "Review",
			slug: "review",
			propertiesSchema: reviewPropertiesSchemaByEntity("collection"),
		},
		{
			name: "Add Entity to Collection",
			slug: "add-entity-to-collection",
			propertiesSchema: {
				fields: {
					entityId: {
						label: "Entity ID",
						type: "string" as const,
						validation: { required: true as const },
						description: "ID of the entity added to the collection",
					},
					entitySchemaSlug: {
						type: "string" as const,
						label: "Entity Schema Slug",
						validation: { required: true as const },
						description: "Schema slug of the entity added to the collection",
					},
					relationshipId: {
						type: "string" as const,
						label: "Relationship ID",
						validation: { required: true as const },
						description: "ID of the membership relationship",
					},
					relationshipProperties: {
						properties: {},
						type: "object" as const,
						label: "Relationship Properties",
						unknownKeys: "passthrough" as const,
						description: "Properties of the membership relationship",
					},
				},
			},
		},
		{
			name: "Remove Entity from Collection",
			slug: "remove-entity-from-collection",
			propertiesSchema: {
				fields: {
					entityId: {
						label: "Entity ID",
						type: "string" as const,
						validation: { required: true as const },
						description: "ID of the entity removed from the collection",
					},
					entitySchemaSlug: {
						type: "string" as const,
						label: "Entity Schema Slug",
						validation: { required: true as const },
						description: "Schema slug of the entity removed from the collection",
					},
					relationshipId: {
						type: "string" as const,
						label: "Relationship ID",
						validation: { required: true as const },
						description: "ID of the membership relationship that was deleted",
					},
					relationshipProperties: {
						properties: {},
						type: "object" as const,
						label: "Relationship Properties",
						unknownKeys: "passthrough" as const,
						description: "Properties of the deleted membership relationship",
					},
				},
			},
		},
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
});
