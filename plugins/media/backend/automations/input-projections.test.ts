import { expect, it } from "vitest";

import { manifest as customPublishYear } from "./custom-publish-year-policy.sandbox";
import { manifest as ensureMediaLibrary } from "./ensure-media-library-membership.sandbox";
import { manifest as episodicPolicy } from "./episodic-session-policy.sandbox";
import { manifest as jellyfin } from "./jellyfin-push.sandbox";
import { manifest as association } from "./media-association.sandbox";
import { manifest as entityUpdated } from "./media-entity-updated.sandbox";
import { manifest as relationshipSync } from "./media-relationship-sync.sandbox";
import { manifest as notification } from "./notification.sandbox";
import { manifest as radarr } from "./radarr-push.sandbox";
import { manifest as reconcileMediaHistory } from "./reconcile-media-history.sandbox";
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
		[customPublishYear.slug]: customPublishYear.inputProjection,
		[ensureMediaLibrary.slug]: ensureMediaLibrary.inputProjection,
		[reconcileMediaHistory.slug]: reconcileMediaHistory.inputProjection,
		[recordMediaLibraryMembership.slug]: recordMediaLibraryMembership.inputProjection,
	}).toEqual({
		"policy.media-episodic-session": { event: { properties: [] } },
		"automation.review-created": { event: { properties: [], compareProperties: [] } },
		"policy.media-custom-publish-year": { entity: { properties: ["publishDate", "publishYear"] } },
		"trigger.jellyfin-push": { event: { compareProperties: [], properties: ["completionSilent"] } },
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
		"automation.reconcile-media-history": {
			event: { compareProperties: [], properties: ["completionKey"] },
			signal: { properties: ["entitySchemaSlug", "oldStatus", "newStatus"] },
		},
		"automation.ensure-media-library-membership": {
			providerEntityImport: true,
			entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
			event: {
				compareProperties: [],
				properties: ["entityId", "entitySchemaSlug", "completionSilent"],
			},
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
