import type { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";

import type { BuiltinSignalSchemaInput } from "#modules/signals/signal-schemas-repository";

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

const mediaAudience = (relationshipSchemaSlug: RelationshipSchemaSlug) => ({
	relationshipSchemaSlug,
	kind: "related_users" as const,
	subjectSide: "source" as const,
});

export const builtinSignalSchemas = (
	mediaMonitoringRelationshipSchemaSlug: RelationshipSchemaSlug,
) =>
	[
		{
			catalogState: "active",
			slug: "review.created",
			name: "Review Created",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityId: {
						type: "string",
						label: "Entity ID",
						validation: { required: true },
						description: "Reviewed entity ID",
					},
					entityName: {
						type: "string",
						label: "Entity name",
						validation: { required: true },
						description: "Reviewed entity name",
					},
					reviewEventId: {
						type: "string",
						label: "Review event ID",
						validation: { required: true },
						description: "Created review event ID",
					},
					entitySchemaSlug: {
						type: "string",
						label: "Entity schema slug",
						validation: { required: true },
						description: "Reviewed entity schema slug",
					},
				},
			},
		},
		...(
			[
				["person.media.associated", "Person Media Associated"],
				["company.media.associated", "Company Media Associated"],
				["person.media-group.associated", "Person Media Group Associated"],
				["company.media-group.associated", "Company Media Group Associated"],
			] as const
		).map(([slug, name]) => ({
			name,
			slug,
			catalogState: "active" as const,
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict" as const,
				fields: {
					role: requiredString("Role", "Role in the associated media or group"),
					subjectName: requiredString("Subject name", "Credited person or company name"),
					associatedName: requiredString("Associated name", "Associated media or group name"),
				},
			},
		})),
		{
			catalogState: "active",
			slug: "media.status.changed",
			name: "Media Status Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					oldStatus: requiredString("Old status", "Previous production status"),
					newStatus: requiredString("New status", "Current production status"),
					entityName: requiredString("Entity name", "Changed media name"),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.content-count.changed",
			name: "Media Content Count Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					oldCount: requiredNumber("Old count", "Previous content count"),
					newCount: requiredNumber("New count", "Current content count"),
					entityName: requiredString("Entity name", "Changed media name"),
					contentType: {
						type: "enum",
						label: "Content type",
						validation: { required: true },
						options: ["chapters", "episodes"],
						description: "Type of counted content",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.release-date.changed",
			name: "Media Release Date Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					newDate: { type: "date", label: "New date", description: "Current episode date" },
					oldDate: { type: "date", label: "Old date", description: "Previous episode date" },
					entityName: requiredString("Entity name", "Changed media name"),
					newYear: { type: "integer", label: "New year", description: "Current publish year" },
					oldYear: { type: "integer", label: "Old year", description: "Previous publish year" },
					changeKind: {
						type: "enum",
						label: "Change kind",
						validation: { required: true },
						options: ["publish_year", "episode_date"],
						description: "Kind of release date change",
					},
					episodeNumber: {
						type: "integer",
						label: "Episode number",
						description: "Episode number within its parent",
					},
					seasonNumber: {
						type: "integer",
						label: "Season number",
						description: "Optional season number",
					},
				},
				rules: [
					...(["oldYear", "newYear"] as const).map((field) => ({
						path: [field],
						kind: "validation" as const,
						validation: { required: true as const },
						when: { path: ["changeKind"], operator: "eq" as const, value: "publish_year" },
					})),
					...(["oldDate", "newDate", "episodeNumber"] as const).map((field) => ({
						path: [field],
						kind: "validation" as const,
						validation: { required: true as const },
						when: { path: ["changeKind"], operator: "eq" as const, value: "episode_date" },
					})),
				],
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.name.changed",
			name: "Media Episode Name Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString("Entity name", "Parent media name"),
					newName: { type: "string", label: "New name", description: "Current episode name" },
					oldName: { type: "string", label: "Old name", description: "Previous episode name" },
					episodeNumber: requiredInteger("Episode number", "Episode number within its parent"),
					seasonNumber: {
						type: "integer",
						label: "Season number",
						description: "Optional season number",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.images.changed",
			name: "Media Episode Images Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString("Entity name", "Parent media name"),
					episodeNumber: requiredInteger("Episode number", "Episode number within its parent"),
					seasonNumber: {
						type: "integer",
						label: "Season number",
						description: "Optional season number",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.season-count.changed",
			name: "Media Season Count Changed",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					newCount: requiredInteger("New count", "Current season count"),
					entityName: requiredString("Entity name", "Changed show name"),
					oldCount: requiredInteger("Old count", "Previous season count"),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.discovered",
			name: "Media Episode Discovered",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					oldCount: requiredInteger("Old count", "Previous episode count"),
					newCount: requiredInteger("New count", "Current episode count"),
					entityName: requiredString("Entity name", "Parent media name"),
					discoveredCount: requiredInteger("Discovered count", "Newly discovered episodes"),
					seasonNumber: {
						type: "integer",
						label: "Season number",
						description: "Optional season number",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "workout.created",
			name: "Workout Created",
			audiencePolicy: { kind: "actor" },
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					workoutId: {
						type: "string",
						label: "Workout ID",
						validation: { required: true },
						description: "Created workout ID",
					},
					workoutName: {
						type: "string",
						label: "Workout name",
						validation: { required: true },
						description: "Created workout name",
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "integration.disabled",
			name: "Integration Disabled",
			audiencePolicy: { kind: "actor" },
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
	] as const satisfies ReadonlyArray<BuiltinSignalSchemaInput>;
