import type { SignalSchema } from "@ryot/contract/modules/automations/schemas";
import type { RelationshipSchemaId } from "@ryot/contract/schema/brands";
import type { AppPropertyDefinition, AppSchema } from "@ryot/contract/schema/property-schema";

const requiredString = (label: string, description: string) => ({
	label,
	description,
	type: "string" as const,
	validation: { required: true as const },
});

const requiredNumber = (label: string, description: string) => ({
	label,
	description,
	type: "number" as const,
	validation: { required: true as const },
});

const requiredInteger = (label: string, description: string) => ({
	label,
	description,
	type: "integer" as const,
	validation: { required: true as const },
});

const optionalInteger = (label: string, description: string) => ({
	label,
	description,
	type: "integer" as const,
});

const optionalString = (label: string, description: string) => ({
	label,
	description,
	type: "string" as const,
});

const strict = (fields: Record<string, AppPropertyDefinition>, rules?: AppSchema["rules"]) => ({
	rules,
	fields,
	unknownKeys: "strict" as const,
});

export type BuiltinSignalSchema = Pick<
	SignalSchema,
	"audiencePolicy" | "catalogState" | "name" | "propertiesSchema" | "slug"
>;

const actorSignalSchemas = (): ReadonlyArray<BuiltinSignalSchema> => [
	{
		catalogState: "active",
		name: "Integration Disabled",
		slug: "integration.disabled",
		audiencePolicy: { kind: "actor" },
		propertiesSchema: strict({
			integrationId: requiredString("Integration ID", "Disabled integration ID"),
			providerName: requiredString("Provider Name", "Disabled integration provider"),
		}),
	},
	{
		name: "Review Created",
		slug: "review.created",
		catalogState: "active",
		audiencePolicy: { kind: "actor" },
		propertiesSchema: strict({
			entityId: requiredString("Entity ID", "Reviewed entity ID"),
			entityName: requiredString("Entity Name", "Reviewed entity name"),
			reviewEventId: requiredString("Review Event ID", "Created review event ID"),
			entitySchemaSlug: requiredString("Entity Schema", "Reviewed entity schema slug"),
		}),
	},
	{
		catalogState: "active",
		name: "Workout Created",
		slug: "workout.created",
		audiencePolicy: { kind: "actor" },
		propertiesSchema: strict({
			workoutId: requiredString("Workout ID", "Created workout ID"),
			workoutName: requiredString("Workout Name", "Created workout name"),
		}),
	},
];

const relatedSignal = (
	name: string,
	slug: string,
	fields: Record<string, AppPropertyDefinition>,
	relationshipSchemaId: RelationshipSchemaId,
	rules?: AppSchema["rules"],
): BuiltinSignalSchema => ({
	name,
	slug,
	catalogState: "active",
	propertiesSchema: strict(fields, rules),
	audiencePolicy: { kind: "related_users", subjectSide: "source", relationshipSchemaId },
});

export const builtinSignalSchemas = (
	mediaMonitoringRelationshipSchemaId: RelationshipSchemaId,
): ReadonlyArray<BuiltinSignalSchema> => {
	const schemas = [...actorSignalSchemas()];

	const entityName = requiredString("Entity Name", "Immutable display name of the media entity");
	const counts = {
		newCount: requiredInteger("New Count", "Count after the provider refresh"),
		oldCount: requiredInteger("Old Count", "Count before the provider refresh"),
	};
	const associationFields = {
		role: requiredString("Role", "Newly discovered association role"),
		subjectName: requiredString("Subject Name", "Person or company name"),
		associatedName: requiredString("Associated Name", "Associated media or group name"),
	};

	return [
		...schemas,
		relatedSignal(
			"Media Status Changed",
			"media.status.changed",
			{
				entityName,
				newStatus: requiredString("New Status", "Status after the provider refresh"),
				oldStatus: requiredString("Old Status", "Status before the provider refresh"),
			},
			mediaMonitoringRelationshipSchemaId,
		),
		relatedSignal(
			"Media Content Count Changed",
			"media.content-count.changed",
			{
				entityName,
				newCount: requiredNumber("New Count", "Count after the provider refresh"),
				oldCount: requiredNumber("Old Count", "Count before the provider refresh"),
				contentType: {
					type: "enum",
					label: "Content Type",
					validation: { required: true },
					options: ["chapters", "episodes"],
					description: "Kind of content whose count changed",
				},
			},
			mediaMonitoringRelationshipSchemaId,
		),
		relatedSignal(
			"Media Release Date Changed",
			"media.release-date.changed",
			{
				entityName,
				newYear: optionalInteger("New Year", "New media publish year"),
				oldYear: optionalInteger("Old Year", "Previous media publish year"),
				newDate: { ...optionalString("New Date", "New episode release date"), type: "date" },
				episodeNumber: optionalInteger("Episode Number", "Episode number for an episode date"),
				seasonNumber: optionalInteger("Season Number", "Season number for a show episode date"),
				oldDate: { ...optionalString("Old Date", "Previous episode release date"), type: "date" },
				changeKind: {
					type: "enum",
					label: "Change Kind",
					validation: { required: true },
					options: ["publish_year", "episode_date"],
					description: "Release date field that changed",
				},
			},
			mediaMonitoringRelationshipSchemaId,
			[
				...["oldYear", "newYear"].map((path) => ({
					path: [path],
					kind: "validation" as const,
					validation: { required: true as const },
					when: { path: ["changeKind"], value: "publish_year", operator: "eq" as const },
				})),
				...["oldDate", "newDate", "episodeNumber"].map((path) => ({
					path: [path],
					kind: "validation" as const,
					validation: { required: true as const },
					when: { path: ["changeKind"], value: "episode_date", operator: "eq" as const },
				})),
			],
		),
		relatedSignal(
			"Media Episode Name Changed",
			"media.episode.name.changed",
			{
				entityName,
				episodeNumber: requiredInteger("Episode Number", "Episode number"),
				seasonNumber: optionalInteger("Season Number", "Show season number"),
				newName: optionalString("New Name", "Episode name after the provider refresh"),
				oldName: optionalString("Old Name", "Episode name before the provider refresh"),
			},
			mediaMonitoringRelationshipSchemaId,
		),
		relatedSignal(
			"Media Episode Images Changed",
			"media.episode.images.changed",
			{
				entityName,
				episodeNumber: requiredInteger("Episode Number", "Episode number"),
				seasonNumber: optionalInteger("Season Number", "Show season number"),
			},
			mediaMonitoringRelationshipSchemaId,
		),
		relatedSignal(
			"Media Season Count Changed",
			"media.season-count.changed",
			{ ...counts, entityName },
			mediaMonitoringRelationshipSchemaId,
		),
		relatedSignal(
			"Media Episode Discovered",
			"media.episode.discovered",
			{
				...counts,
				entityName,
				seasonNumber: optionalInteger("Season Number", "Show season number"),
				discoveredCount: requiredInteger("Discovered Count", "New episodes discovered"),
			},
			mediaMonitoringRelationshipSchemaId,
		),
		...[
			{ name: "Person Associated With Media", slug: "person.media.associated" },
			{ name: "Company Associated With Media", slug: "company.media.associated" },
			{ name: "Person Associated With Media Group", slug: "person.media-group.associated" },
			{ name: "Company Associated With Media Group", slug: "company.media-group.associated" },
		].map(({ name, slug }) =>
			relatedSignal(name, slug, associationFields, mediaMonitoringRelationshipSchemaId),
		),
	];
};
