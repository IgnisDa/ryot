import type { ManifestText } from "@ryot-app/contract/modules/plugins/manifest-text";

import { creditRoleCodes } from "../../shared/credit-roles";
import { catalogMessage } from "../../shared/messages.generated";

const requiredString = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "string" as const,
	validation: { required: true as const },
});

const requiredNumber = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "number" as const,
	validation: { required: true as const },
});

const requiredInteger = (label: ManifestText, description: string) => ({
	label,
	description,
	type: "integer" as const,
	validation: { required: true as const },
});

const mediaAudience = (relationshipSchemaSlug: string) => ({
	relationshipSchemaSlug,
	kind: "related_users" as const,
	subjectSide: "source" as const,
});

export const mediaSignalSchemas = (mediaMonitoringRelationshipSchemaSlug: string) =>
	[
		{
			catalogState: "active",
			slug: "review.created",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.review-created.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityId: {
						type: "string",
						validation: { required: true },
						description: "Reviewed entity ID",
						label: catalogMessage("property.entity-id"),
					},
					entityName: {
						type: "string",
						validation: { required: true },
						description: "Reviewed entity name",
						label: catalogMessage("property.entity-name"),
					},
					reviewEventId: {
						type: "string",
						validation: { required: true },
						description: "Created review event ID",
						label: catalogMessage("property.review-event-id"),
					},
					entitySchemaSlug: {
						type: "string",
						validation: { required: true },
						description: "Reviewed entity schema slug",
						label: catalogMessage("property.entity-schema-slug"),
					},
				},
			},
		},
		...(
			[
				["person.media.associated", catalogMessage("signal-schema.person-media-associated.name")],
				["company.media.associated", catalogMessage("signal-schema.company-media-associated.name")],
				[
					"person.media-group.associated",
					catalogMessage("signal-schema.person-media-group-associated.name"),
				],
				[
					"company.media-group.associated",
					catalogMessage("signal-schema.company-media-group-associated.name"),
				],
			] as const
		).map(([slug, name]) => ({
			name,
			slug,
			catalogState: "active" as const,
			notificationHookSlug: "media.notification" as const,
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict" as const,
				fields: {
					subjectName: requiredString(
						catalogMessage("property.subject-name"),
						"Credited person or company name",
					),
					associatedName: requiredString(
						catalogMessage("property.associated-name"),
						"Associated media or group name",
					),
					role: {
						type: "string" as const,
						label: catalogMessage("property.role"),
						description: "Role in the associated media or group, as the provider names it",
					},
					roleCode: {
						type: "enum" as const,
						label: catalogMessage("property.role-code"),
						description: "Standard role in the associated media or group, when no named role",
						choices: {
							kind: "static" as const,
							values: creditRoleCodes.map((value) => ({ value })),
						},
					},
				},
			},
		})),
		{
			catalogState: "active",
			slug: "media.status.changed",
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.media-status-changed.name"),
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Changed media name"),
					newStatus: requiredString(
						catalogMessage("property.new-status"),
						"Current production status",
					),
					oldStatus: requiredString(
						catalogMessage("property.old-status"),
						"Previous production status",
					),
					entitySchemaSlug: requiredString(
						catalogMessage("property.entity-schema-slug"),
						"Changed media schema slug",
					),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.content-count.changed",
			notificationHookSlug: "media.notification",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			name: catalogMessage("signal-schema.media-content-count-changed.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					newCount: requiredNumber(catalogMessage("property.new-count"), "Current content count"),
					oldCount: requiredNumber(catalogMessage("property.old-count"), "Previous content count"),
					entityName: requiredString(catalogMessage("property.entity-name"), "Changed media name"),
					contentType: {
						type: "enum",
						validation: { required: true },
						description: "Type of counted content",
						label: catalogMessage("property.content-type"),
						choices: { kind: "static", values: [{ value: "chapters" }, { value: "episodes" }] },
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.release-date.changed",
			notificationHookSlug: "media.notification",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			name: catalogMessage("signal-schema.media-release-date-changed.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				rules: [
					...(["oldYear", "newYear"] as const).map((field) => ({
						path: [field],
						kind: "validation" as const,
						validation: { required: true as const },
						when: { path: ["changeKind"], value: "publish_year", operator: "eq" as const },
					})),
					...(["oldDate", "newDate", "episodeNumber"] as const).map((field) => ({
						path: [field],
						kind: "validation" as const,
						validation: { required: true as const },
						when: { path: ["changeKind"], value: "episode_date", operator: "eq" as const },
					})),
				],
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Changed media name"),
					newDate: {
						type: "date",
						description: "Current episode date",
						label: catalogMessage("property.new-date"),
					},
					oldDate: {
						type: "date",
						description: "Previous episode date",
						label: catalogMessage("property.old-date"),
					},
					newYear: {
						type: "integer",
						description: "Current publish year",
						label: catalogMessage("property.new-year"),
					},
					oldYear: {
						type: "integer",
						description: "Previous publish year",
						label: catalogMessage("property.old-year"),
					},
					seasonNumber: {
						type: "integer",
						description: "Optional season number",
						label: catalogMessage("property.season-number"),
					},
					episodeNumber: {
						type: "integer",
						description: "Episode number within its parent",
						label: catalogMessage("property.episode-number"),
					},
					changeKind: {
						type: "enum",
						validation: { required: true },
						description: "Kind of release date change",
						label: catalogMessage("property.change-kind"),
						choices: {
							kind: "static",
							values: [{ value: "publish_year" }, { value: "episode_date" }],
						},
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.name.changed",
			notificationHookSlug: "media.notification",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			name: catalogMessage("signal-schema.media-episode-name-changed.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Parent media name"),
					episodeNumber: requiredInteger(
						catalogMessage("property.episode-number"),
						"Episode number within its parent",
					),
					newName: {
						type: "string",
						description: "Current episode name",
						label: catalogMessage("property.new-name"),
					},
					oldName: {
						type: "string",
						description: "Previous episode name",
						label: catalogMessage("property.old-name"),
					},
					seasonNumber: {
						type: "integer",
						description: "Optional season number",
						label: catalogMessage("property.season-number"),
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.images.changed",
			notificationHookSlug: "media.notification",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			name: catalogMessage("signal-schema.media-episode-images-changed.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Parent media name"),
					episodeNumber: requiredInteger(
						catalogMessage("property.episode-number"),
						"Episode number within its parent",
					),
					seasonNumber: {
						type: "integer",
						description: "Optional season number",
						label: catalogMessage("property.season-number"),
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.season-count.changed",
			notificationHookSlug: "media.notification",
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			name: catalogMessage("signal-schema.media-season-count-changed.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					newCount: requiredInteger(catalogMessage("property.new-count"), "Current season count"),
					entityName: requiredString(catalogMessage("property.entity-name"), "Changed show name"),
					oldCount: requiredInteger(catalogMessage("property.old-count"), "Previous season count"),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.released",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.media-released.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Released media name"),
					seasonNumber: {
						type: "integer",
						description: "Optional season number",
						label: catalogMessage("property.season-number"),
					},
					episodeNumber: {
						type: "integer",
						description: "Optional episode number",
						label: catalogMessage("property.episode-number"),
					},
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.progress-stale",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.media-progress-stale.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Stale media name"),
					days: requiredInteger(catalogMessage("property.days"), "Days without lifecycle activity"),
					lifecycleState: requiredString(
						catalogMessage("property.lifecycle-state"),
						"Unchanged lifecycle state",
					),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episodes-available",
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.media-episodes-available.name"),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(
						catalogMessage("property.entity-name"),
						"Caught-up series name",
					),
				},
			},
		},
		{
			catalogState: "active",
			slug: "media.episode.discovered",
			notificationHookSlug: "media.notification",
			name: catalogMessage("signal-schema.media-episode-discovered.name"),
			audiencePolicy: mediaAudience(mediaMonitoringRelationshipSchemaSlug),
			propertiesSchema: {
				unknownKeys: "strict",
				fields: {
					entityName: requiredString(catalogMessage("property.entity-name"), "Parent media name"),
					newCount: requiredInteger(catalogMessage("property.new-count"), "Current episode count"),
					oldCount: requiredInteger(catalogMessage("property.old-count"), "Previous episode count"),
					discoveredCount: requiredInteger(
						catalogMessage("property.discovered-count"),
						"Newly discovered episodes",
					),
					seasonNumber: {
						type: "integer",
						description: "Optional season number",
						label: catalogMessage("property.season-number"),
					},
				},
			},
		},
	] as const;
