import { defineAutomation, notifySignals } from "@ryot-app/plugin-backend-sdk/automation";
import { CHANGE_SET_LIMITS } from "@ryot-app/plugin-backend-sdk/core";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { isCalendarDate } from "@ryot-app/plugin-kit/messages";

import { type MediaAssociation, MediaAssociationSchema } from "../../shared/credit-roles";
import { catalogMessage } from "../../shared/messages.generated";

export const manifest = defineManifest({
	kind: "automation",
	automationType: "automation",
	name: "Media Signal Notification",
	slug: "automation.media-notification",
	inputProjection: {
		signal: {
			properties: [
				"entityName",
				"subjectName",
				"associations",
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
				"days",
				"lifecycleState",
			],
		},
	},
});

const optionalNumber = Schema.optional(Schema.NullOr(Schema.Finite));
const optionalString = Schema.optional(Schema.NullOr(Schema.String));
const calendarDate = Schema.String.pipe(Schema.refine(isCalendarDate));
const named = { entityName: Schema.String };
const episode = { episodeNumber: Schema.Finite, seasonNumber: optionalNumber };
const countChange = { ...named, oldCount: Schema.Finite, newCount: Schema.Finite };

const episodeLabel = ({
	seasonNumber,
	episodeNumber,
}: {
	readonly episodeNumber: number;
	readonly seasonNumber?: null | number | undefined;
}) =>
	seasonNumber === undefined || seasonNumber === null
		? catalogMessage("notification.episode-label.numbered", { episode: episodeNumber })
		: catalogMessage("notification.episode-label.seasonal", {
				season: seasonNumber,
				episode: episodeNumber,
			});

const association = {
	properties: Schema.Struct({
		subjectName: Schema.String,
		associations: Schema.Array(MediaAssociationSchema),
	}),
	/** One message per association; past the notification limit, the last one counts the rest. */
	notify: ({
		subjectName,
		associations,
	}: {
		readonly subjectName: string;
		readonly associations: ReadonlyArray<MediaAssociation>;
	}) => {
		const message = (item: MediaAssociation) =>
			"role" in item
				? catalogMessage("notification.associated-named-role", {
						subjectName,
						role: item.role,
						associatedName: item.associatedName,
					})
				: catalogMessage("notification.associated", {
						subjectName,
						role: item.roleCode,
						associatedName: item.associatedName,
					});
		if (associations.length <= CHANGE_SET_LIMITS.notifications) {
			return associations.map(message);
		}
		const listed = associations.slice(0, CHANGE_SET_LIMITS.notifications - 1);
		return [
			...listed.map(message),
			catalogMessage("notification.associated-more", {
				subjectName,
				count: associations.length - listed.length,
			}),
		];
	},
};

export default defineAutomation({
	manifest,
	run: notifySignals({
		"person.media.associated": association,
		"company.media.associated": association,
		"person.media-group.associated": association,
		"company.media-group.associated": association,
		"review.created": {
			properties: Schema.Struct(named),
			notify: ({ entityName }) => catalogMessage("notification.review-created", { entityName }),
		},
		"media.episodes-available": {
			properties: Schema.Struct(named),
			notify: ({ entityName }) => catalogMessage("notification.episodes-available", { entityName }),
		},
		"media.season-count.changed": {
			properties: Schema.Struct(countChange),
			notify: (properties) => catalogMessage("notification.season-count-changed", properties),
		},
		"media.status.changed": {
			notify: (properties) => catalogMessage("notification.status-changed", properties),
			properties: Schema.Struct({ ...named, oldStatus: Schema.String, newStatus: Schema.String }),
		},
		"media.content-count.changed": {
			notify: (properties) => catalogMessage("notification.content-count-changed", properties),
			properties: Schema.Struct({
				...countChange,
				contentType: Schema.Literals(["chapters", "episodes"]),
			}),
		},
		"media.episode.images.changed": {
			properties: Schema.Struct({ ...named, ...episode }),
			notify: (properties) =>
				catalogMessage("notification.episode-image-changed", {
					episode: episodeLabel(properties),
					entityName: properties.entityName,
				}),
		},
		"media.progress-stale": {
			properties: Schema.Struct({ ...named, days: Schema.Finite, lifecycleState: Schema.String }),
			notify: ({ days, entityName, lifecycleState }) =>
				catalogMessage("notification.progress-stale", {
					days,
					entityName,
					state: lifecycleState === "on_hold" ? "on_hold" : "in_progress",
				}),
		},
		"media.released": {
			properties: Schema.Struct({
				...named,
				seasonNumber: optionalNumber,
				episodeNumber: optionalNumber,
			}),
			notify: ({ entityName, seasonNumber, episodeNumber }) =>
				episodeNumber === undefined || episodeNumber === null
					? catalogMessage("notification.released", { entityName })
					: catalogMessage("notification.episode-released", {
							entityName,
							episode: episodeLabel({ seasonNumber, episodeNumber }),
						}),
		},
		"media.episode.discovered": {
			properties: Schema.Struct({
				...named,
				seasonNumber: optionalNumber,
				discoveredCount: Schema.Finite,
			}),
			notify: ({ entityName, seasonNumber, discoveredCount: count }) =>
				seasonNumber === undefined || seasonNumber === null
					? catalogMessage("notification.episodes-discovered", { count, entityName })
					: catalogMessage("notification.episodes-discovered-in-season", {
							count,
							entityName,
							season: seasonNumber,
						}),
		},
		"media.episode.name.changed": {
			properties: Schema.Struct({
				...named,
				...episode,
				oldName: optionalString,
				newName: optionalString,
			}),
			notify: (properties) => {
				const oldName = properties.oldName ?? null;
				const newName = properties.newName ?? null;
				return catalogMessage("notification.episode-name-changed", {
					oldName: oldName ?? "",
					newName: newName ?? "",
					episode: episodeLabel(properties),
					entityName: properties.entityName,
					oldNaming: oldName === null ? "missing" : "named",
					newNaming: newName === null ? "missing" : "named",
				});
			},
		},
		"media.release-date.changed": {
			properties: Schema.Union([
				Schema.Struct({
					...named,
					oldYear: Schema.Finite,
					newYear: Schema.Finite,
					changeKind: Schema.Literal("publish_year"),
				}),
				Schema.Struct({
					...named,
					...episode,
					oldDate: calendarDate,
					newDate: calendarDate,
					changeKind: Schema.Literal("episode_date"),
				}),
			]),
			notify: (properties) =>
				properties.changeKind === "publish_year"
					? catalogMessage("notification.publish-year-changed", {
							oldYear: properties.oldYear,
							newYear: properties.newYear,
							entityName: properties.entityName,
						})
					: catalogMessage("notification.episode-release-date-changed", {
							oldDate: properties.oldDate,
							newDate: properties.newDate,
							episode: episodeLabel(properties),
							entityName: properties.entityName,
						}),
		},
	}),
});
