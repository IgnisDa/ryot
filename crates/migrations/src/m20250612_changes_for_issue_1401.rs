use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Convert all notification content values from PascalCase to snake_case
        db.execute_unprepared(
            r#"
UPDATE "notification_platform"
SET "configured_events" = (
    SELECT ARRAY(
        SELECT CASE unnested_event
            WHEN 'ReviewPosted' THEN 'review_posted'
            WHEN 'MetadataPublished' THEN 'metadata_published'
            WHEN 'NewWorkoutCreated' THEN 'new_workout_created'
            WHEN 'OutdatedSeenEntries' THEN 'outdated_seen_entries'
            WHEN 'MetadataStatusChanged' THEN 'metadata_status_changed'
            WHEN 'MetadataEpisodeReleased' THEN 'metadata_episode_released'
            WHEN 'PersonMetadataAssociated' THEN 'person_metadata_associated'
            WHEN 'MetadataReleaseDateChanged' THEN 'metadata_release_date_changed'
            WHEN 'MetadataEpisodeNameChanged' THEN 'metadata_episode_name_changed'
            WHEN 'MetadataEpisodeImagesChanged' THEN 'metadata_episode_images_changed'
            WHEN 'PersonMetadataGroupAssociated' THEN 'person_metadata_group_associated'
            WHEN 'MetadataNumberOfSeasonsChanged' THEN 'metadata_number_of_seasons_changed'
            WHEN 'MetadataChaptersOrEpisodesChanged' THEN 'metadata_chapters_or_episodes_changed'
            WHEN 'NotificationFromReminderCollection' THEN 'notification_from_reminder_collection'
            WHEN 'EntityRemovedFromMonitoringCollection' THEN 'entity_removed_from_monitoring_collection'
            WHEN 'IntegrationDisabledDueToTooManyErrors' THEN 'integration_disabled_due_to_too_many_errors'
            ELSE unnested_event
        END
        FROM unnest("configured_events") AS unnested_event
    )
)
WHERE "configured_events" IS NOT NULL;
            "#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
