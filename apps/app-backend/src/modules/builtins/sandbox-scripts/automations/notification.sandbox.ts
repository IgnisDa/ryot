import { defineManifest, type JsonValue } from "@ryot/sandbox-sdk";
import { defineAutomation, type AutomationSignalSnapshot } from "@ryot/sandbox-sdk/automation";

export const manifest = defineManifest({
	kind: "automation",
	requiredAppConfigKeys: [],
	name: "Signal Notification",
	slug: "automation.notification",
	capabilities: ["sendNotification"],
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

const formatMessage = (signal: AutomationSignalSnapshot) => {
	if (signal.signalSchemaSlug === "review.created") {
		return `Review posted for ${stringProperty(signal.properties, "entityName")}`;
	}
	if (signal.signalSchemaSlug === "workout.created") {
		return `Workout ${stringProperty(signal.properties, "workoutName")} was created`;
	}
	if (signal.signalSchemaSlug === "integration.disabled") {
		return `Integration ${stringProperty(signal.properties, "providerName")} has been disabled due to too many errors`;
	}
	if (signal.signalSchemaSlug === "media.status.changed") {
		return `Status of ${stringProperty(signal.properties, "entityName")} changed from ${stringProperty(signal.properties, "oldStatus")} to ${stringProperty(signal.properties, "newStatus")}`;
	}
	if (signal.signalSchemaSlug === "media.content-count.changed") {
		return `Number of ${stringProperty(signal.properties, "contentType")} changed from ${numberProperty(signal.properties, "oldCount")} to ${numberProperty(signal.properties, "newCount")} for ${stringProperty(signal.properties, "entityName")}`;
	}
	if (signal.signalSchemaSlug === "media.release-date.changed") {
		const entityName = stringProperty(signal.properties, "entityName");
		if (stringProperty(signal.properties, "changeKind") === "publish_year") {
			return `Publish year changed from ${numberProperty(signal.properties, "oldYear")} to ${numberProperty(signal.properties, "newYear")} for ${entityName}`;
		}
		const episodeNumber = numberProperty(signal.properties, "episodeNumber");
		const seasonNumber = optionalNumberProperty(signal.properties, "seasonNumber");
		const episode =
			seasonNumber === null ? `EP${episodeNumber}` : `S${seasonNumber}E${episodeNumber}`;
		return `Episode release date changed from ${stringProperty(signal.properties, "oldDate")} to ${stringProperty(signal.properties, "newDate")} (${episode}) for ${entityName}`;
	}
	if (signal.signalSchemaSlug === "media.episode.name.changed") {
		const episodeNumber = numberProperty(signal.properties, "episodeNumber");
		const seasonNumber = optionalNumberProperty(signal.properties, "seasonNumber");
		const episode =
			seasonNumber === null ? `EP${episodeNumber}` : `S${seasonNumber}E${episodeNumber}`;
		return `Episode name changed from ${JSON.stringify(optionalStringProperty(signal.properties, "oldName"))} to ${JSON.stringify(optionalStringProperty(signal.properties, "newName"))} (${episode}) for ${stringProperty(signal.properties, "entityName")}`;
	}
	if (signal.signalSchemaSlug === "media.episode.images.changed") {
		const episodeNumber = numberProperty(signal.properties, "episodeNumber");
		const seasonNumber = optionalNumberProperty(signal.properties, "seasonNumber");
		const episode =
			seasonNumber === null ? `EP${episodeNumber}` : `S${seasonNumber}E${episodeNumber}`;
		return `Episode image changed for ${episode} in ${stringProperty(signal.properties, "entityName")}`;
	}
	throw new Error(`Unsupported signal schema: ${signal.signalSchemaSlug}`);
};

export default defineAutomation({
	manifest,
	run: ({ automation }, host) => {
		if (automation.source.kind !== "signal") {
			throw new Error("Signal notification requires a signal source");
		}
		return host.sendNotification(formatMessage(automation.source.signal));
	},
});
