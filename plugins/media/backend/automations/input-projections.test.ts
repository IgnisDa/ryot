import { expect, it } from "vitest";

import { manifest as autoCompleteParent } from "./auto-complete-episodic-parent.sandbox";
import { manifest as autoCompleteProgress } from "./auto-complete-on-full-progress.sandbox";
import { manifest as ensureMediaLibrary } from "./ensure-media-library-membership.sandbox";
import { manifest as episodicPolicy } from "./episodic-session-policy.sandbox";
import { manifest as jellyfin } from "./jellyfin-push.sandbox";
import { manifest as association } from "./media-association.sandbox";
import { manifest as entityUpdated } from "./media-entity-updated.sandbox";
import { manifest as relationshipSync } from "./media-relationship-sync.sandbox";
import { manifest as notification } from "./notification.sandbox";
import { manifest as radarr } from "./radarr-push.sandbox";
import { manifest as recordMediaLibraryMembership } from "./record-media-library-membership-event.sandbox";
import { manifest as reviewCreated } from "./review-created.sandbox";
import { manifest as sonarr } from "./sonarr-push.sandbox";

it("declares the media automation input projections", () => {
	expect({
		[radarr.slug]: radarr.inputProjection,
		[sonarr.slug]: sonarr.inputProjection,
		[jellyfin.slug]: jellyfin.inputProjection,
		[association.slug]: association.inputProjection,
		[notification.slug]: notification.inputProjection,
		[reviewCreated.slug]: reviewCreated.inputProjection,
		[entityUpdated.slug]: entityUpdated.inputProjection,
		[episodicPolicy.slug]: episodicPolicy.inputProjection,
		[relationshipSync.slug]: relationshipSync.inputProjection,
		[ensureMediaLibrary.slug]: ensureMediaLibrary.inputProjection,
		[autoCompleteParent.slug]: autoCompleteParent.inputProjection,
		[autoCompleteProgress.slug]: autoCompleteProgress.inputProjection,
		[recordMediaLibraryMembership.slug]: recordMediaLibraryMembership.inputProjection,
	}).toEqual({
		"policy.media-episodic-session": { event: { properties: [] } },
		"trigger.jellyfin-push": { event: { properties: [], compareProperties: [] } },
		"automation.review-created": { event: { properties: [], compareProperties: [] } },
		"trigger.sonarr-push": {
			event: { compareProperties: [], properties: ["entitySchemaSlug", "entityId"] },
		},
		"trigger.radarr-push": {
			event: { compareProperties: [], properties: ["entitySchemaSlug", "entityId"] },
		},
		"automation.media-association": {
			relationship: { properties: ["roles"], compareProperties: [], parentEntityProperties: [] },
		},
		"automation.record-media-library-membership-event": {
			relationship: { properties: [], compareProperties: [], parentEntityProperties: [] },
		},
		"automation.media-relationship-sync": {
			relationship: {
				properties: [],
				compareProperties: [],
				parentEntityProperties: ["seasonNumber"],
			},
		},
		"trigger.auto-complete-on-full-progress": {
			event: {
				compareProperties: [],
				properties: ["progressPercent", "animeEpisode", "mangaChapter", "consumedOn"],
			},
		},
		"automation.media-auto-complete-episodic-parent": {
			event: { properties: [], compareProperties: [] },
			signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
		},
		"automation.ensure-media-library-membership": {
			providerEntityImport: true,
			entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
			event: { compareProperties: [], properties: ["entityId", "entitySchemaSlug"] },
		},
		"automation.media-entity-updated": {
			entity: {
				parentEntityProperties: ["seasonNumber"],
				compareProperties: [{ property: "images", equality: "unordered-array" }],
				properties: [
					"productionStatus",
					"publishYear",
					"episodes",
					"chapters",
					"episodeNumber",
					"publishDate",
				],
			},
		},
		"automation.media-notification": {
			signal: {
				properties: [
					"entityName",
					"subjectName",
					"associatedName",
					"role",
					"oldStatus",
					"newStatus",
					"contentType",
					"oldCount",
					"newCount",
					"seasonNumber",
					"discoveredCount",
					"changeKind",
					"oldYear",
					"newYear",
					"episodeNumber",
					"oldDate",
					"newDate",
					"oldName",
					"newName",
				],
			},
		},
	});
});
