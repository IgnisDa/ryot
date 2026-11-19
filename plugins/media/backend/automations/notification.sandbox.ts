import type { AutomationInput } from "@ryot-app/plugin-backend-sdk/automation";
import { defineAutomation } from "@ryot-app/plugin-backend-sdk/automation";
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import { isCalendarDate } from "@ryot-app/plugin-kit/messages";

import { isCreditRoleCode } from "../../shared/credit-roles";
import { catalogMessage } from "../../shared/messages.generated";

type AutomationSignalSnapshot = Extract<
	AutomationInput["automation"]["payload"],
	{ readonly resource: "signal" }
>;

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
				"associatedName",
				"role",
				"roleCode",
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

const stringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

const numberProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (typeof value !== "number") {
		throw new Error(`Signal property ${key} must be a number`);
	}
	return value;
};

const optionalNumberProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "number") {
		throw new Error(`Signal property ${key} must be a number`);
	}
	return value;
};

const optionalStringProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = properties[key];
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string") {
		throw new Error(`Signal property ${key} must be a string`);
	}
	return value;
};

const episodeLabel = (properties: Readonly<Record<string, JsonValue>>) => {
	const episode = numberProperty(properties, "episodeNumber");
	const season = optionalNumberProperty(properties, "seasonNumber");
	return season === null
		? catalogMessage("notification.episode-label.numbered", { episode })
		: catalogMessage("notification.episode-label.seasonal", { season, episode });
};

const calendarDateProperty = (properties: Readonly<Record<string, JsonValue>>, key: string) => {
	const value = stringProperty(properties, key);
	if (!isCalendarDate(value)) {
		throw new Error(`Signal property ${key} must be a calendar date`);
	}
	return value;
};

const roleCodeProperty = (properties: Readonly<Record<string, JsonValue>>) => {
	const value = stringProperty(properties, "roleCode");
	if (!isCreditRoleCode(value)) {
		throw new Error(`Signal property roleCode has unsupported value ${value}`);
	}
	return value;
};

const contentType = (properties: Readonly<Record<string, JsonValue>>) => {
	const value = stringProperty(properties, "contentType");
	if (value !== "chapters" && value !== "episodes") {
		throw new Error(`Signal property contentType has unsupported value ${value}`);
	}
	return value;
};

const notificationMessage = (signal: AutomationSignalSnapshot) => {
	const { properties } = signal;
	if (signal.signalSchemaSlug === "review.created") {
		return catalogMessage("notification.review-created", {
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (
		signal.signalSchemaSlug === "person.media.associated" ||
		signal.signalSchemaSlug === "person.media-group.associated" ||
		signal.signalSchemaSlug === "company.media.associated" ||
		signal.signalSchemaSlug === "company.media-group.associated"
	) {
		const names = {
			subjectName: stringProperty(properties, "subjectName"),
			associatedName: stringProperty(properties, "associatedName"),
		};
		const role = optionalStringProperty(properties, "role");
		return role === null
			? catalogMessage("notification.associated", { ...names, role: roleCodeProperty(properties) })
			: catalogMessage("notification.associated-named-role", { ...names, role });
	}
	if (signal.signalSchemaSlug === "media.status.changed") {
		return catalogMessage("notification.status-changed", {
			oldStatus: stringProperty(properties, "oldStatus"),
			newStatus: stringProperty(properties, "newStatus"),
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (signal.signalSchemaSlug === "media.content-count.changed") {
		return catalogMessage("notification.content-count-changed", {
			contentType: contentType(properties),
			oldCount: numberProperty(properties, "oldCount"),
			newCount: numberProperty(properties, "newCount"),
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (signal.signalSchemaSlug === "media.season-count.changed") {
		return catalogMessage("notification.season-count-changed", {
			oldCount: numberProperty(properties, "oldCount"),
			newCount: numberProperty(properties, "newCount"),
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (signal.signalSchemaSlug === "media.episode.discovered") {
		const season = optionalNumberProperty(properties, "seasonNumber");
		const count = numberProperty(properties, "discoveredCount");
		const entityName = stringProperty(properties, "entityName");
		return season === null
			? catalogMessage("notification.episodes-discovered", { count, entityName })
			: catalogMessage("notification.episodes-discovered-in-season", { count, season, entityName });
	}
	if (signal.signalSchemaSlug === "media.release-date.changed") {
		const entityName = stringProperty(properties, "entityName");
		if (stringProperty(properties, "changeKind") === "publish_year") {
			return catalogMessage("notification.publish-year-changed", {
				entityName,
				oldYear: numberProperty(properties, "oldYear"),
				newYear: numberProperty(properties, "newYear"),
			});
		}
		return catalogMessage("notification.episode-release-date-changed", {
			entityName,
			episode: episodeLabel(properties),
			oldDate: calendarDateProperty(properties, "oldDate"),
			newDate: calendarDateProperty(properties, "newDate"),
		});
	}
	if (signal.signalSchemaSlug === "media.episode.name.changed") {
		const oldName = optionalStringProperty(properties, "oldName");
		const newName = optionalStringProperty(properties, "newName");
		return catalogMessage("notification.episode-name-changed", {
			oldName: oldName ?? "",
			newName: newName ?? "",
			episode: episodeLabel(properties),
			oldNaming: oldName === null ? "missing" : "named",
			newNaming: newName === null ? "missing" : "named",
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (signal.signalSchemaSlug === "media.episode.images.changed") {
		return catalogMessage("notification.episode-image-changed", {
			episode: episodeLabel(properties),
			entityName: stringProperty(properties, "entityName"),
		});
	}
	if (signal.signalSchemaSlug === "media.released") {
		const entityName = stringProperty(properties, "entityName");
		return optionalNumberProperty(properties, "episodeNumber") === null
			? catalogMessage("notification.released", { entityName })
			: catalogMessage("notification.episode-released", {
					entityName,
					episode: episodeLabel(properties),
				});
	}
	if (signal.signalSchemaSlug === "media.progress-stale") {
		return catalogMessage("notification.progress-stale", {
			days: numberProperty(properties, "days"),
			entityName: stringProperty(properties, "entityName"),
			state: stringProperty(properties, "lifecycleState") === "on_hold" ? "on_hold" : "in_progress",
		});
	}
	if (signal.signalSchemaSlug === "media.episodes-available") {
		return catalogMessage("notification.episodes-available", {
			entityName: stringProperty(properties, "entityName"),
		});
	}
	throw new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.payload.resource !== "signal") {
			throw new Error("Signal notification requires a signal source");
		}
		return host.sendNotification(notificationMessage(automation.payload)).pipe(Effect.as(null));
	},
});
