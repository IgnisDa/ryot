import type { NotificationEventType } from "@ryot/contract/modules/notifications/types";

export type MediaMonitoringChange = {
	message: string;
	fingerprint: string;
	eventType: NotificationEventType;
};

const fingerprint = (value: string) => {
	let hash = 0x811c9dc5;
	for (const character of value) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
};

const change = (eventType: NotificationEventType, message: string): MediaMonitoringChange => ({
	message,
	eventType,
	fingerprint: fingerprint(`${eventType}:${message}`),
});

export const mediaMonitoringMessages = {
	associationAdded: (input: {
		entityKind: "company" | "person";
		associationKind: "group" | "metadata";
		associationName: string;
		entityName: string;
		role: string;
	}) =>
		change(
			input.entityKind === "company"
				? input.associationKind === "group"
					? "company_metadata_group_associated"
					: "company_metadata_associated"
				: input.associationKind === "group"
					? "person_metadata_group_associated"
					: "person_metadata_associated",
			`${input.entityName} has been associated with ${input.associationName} as ${input.role}`,
		),
	chaptersOrEpisodesChanged: (input: {
		newCount: number;
		oldCount: number;
		entityName: string;
		contentType: "chapters" | "episodes";
	}) =>
		change(
			"metadata_chapters_or_episodes_changed",
			`Number of ${input.contentType} changed from ${input.oldCount} to ${input.newCount} for ${input.entityName}`,
		),
	episodeImagesChanged: (input: {
		entityName: string;
		episodeNumber: number;
		seasonNumber: number | null;
	}) =>
		change(
			"metadata_episode_images_changed",
			input.seasonNumber === null
				? `Episode image changed for EP${input.episodeNumber} in ${input.entityName}`
				: `Episode image changed for S${input.seasonNumber}E${input.episodeNumber} in ${input.entityName}`,
		),
	episodeNameChanged: (input: {
		entityName: string;
		episodeNumber: number;
		newName: string | null;
		oldName: string | null;
		seasonNumber: number | null;
	}) =>
		change(
			"metadata_episode_name_changed",
			input.seasonNumber === null
				? `Episode name changed from ${JSON.stringify(input.oldName)} to ${JSON.stringify(input.newName)} (EP${input.episodeNumber}) for ${input.entityName}`
				: `Episode name changed from ${JSON.stringify(input.oldName)} to ${JSON.stringify(input.newName)} (S${input.seasonNumber}E${input.episodeNumber}) for ${input.entityName}`,
		),
	episodeReleased: (input: {
		newCount: number;
		oldCount: number;
		entityName: string;
		seasonNumber: number | null;
	}) =>
		change(
			"metadata_episode_released",
			input.seasonNumber === null
				? `Number of episodes changed from ${input.oldCount} to ${input.newCount} for ${input.entityName}`
				: `Number of episodes changed from ${input.oldCount} to ${input.newCount} (Season ${input.seasonNumber}) for ${input.entityName}`,
		),
	episodeReleaseDateChanged: (input: {
		newDate: string;
		oldDate: string;
		entityName: string;
		seasonNumber: number;
		episodeNumber: number;
	}) =>
		change(
			"metadata_release_date_changed",
			`Episode release date changed from ${input.oldDate} to ${input.newDate} (S${input.seasonNumber}E${input.episodeNumber}) for ${input.entityName}`,
		),
	publishYearChanged: (input: { entityName: string; newYear: number; oldYear: number }) =>
		change(
			"metadata_release_date_changed",
			`Publish year changed from ${input.oldYear} to ${input.newYear} for ${input.entityName}`,
		),
	seasonsChanged: (input: { entityName: string; newCount: number; oldCount: number }) =>
		change(
			"metadata_number_of_seasons_changed",
			`Number of seasons changed from ${input.oldCount} to ${input.newCount} for ${input.entityName}`,
		),
	statusChanged: (input: { entityName: string; newStatus: string; oldStatus: string }) =>
		change(
			"metadata_status_changed",
			`Status of ${input.entityName} changed from ${input.oldStatus} to ${input.newStatus}`,
		),
};
