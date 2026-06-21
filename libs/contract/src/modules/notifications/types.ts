export const notificationPlatformKinds = [
	"ntfy",
	"email",
	"gotify",
	"apprise",
	"discord",
	"push_over",
	"push_bullet",
	"push_safer",
	"telegram",
] as const;

export type NotificationPlatformKind = (typeof notificationPlatformKinds)[number];

export const notificationEventTypes = [
	"review_posted",
	"metadata_published",
	"new_workout_created",
	"outdated_seen_entries",
	"metadata_status_changed",
	"metadata_episode_released",
	"person_metadata_associated",
	"metadata_release_date_changed",
	"metadata_episode_name_changed",
	"metadata_episode_images_changed",
	"person_metadata_group_associated",
	"metadata_number_of_seasons_changed",
	"notification_from_reminder_collection",
	"metadata_chapters_or_episodes_changed",
	"integration_disabled_due_to_too_many_errors",
	"metadata_moved_from_completed_to_watchlist_collection",
] as const;

export type NotificationEventType = (typeof notificationEventTypes)[number];
