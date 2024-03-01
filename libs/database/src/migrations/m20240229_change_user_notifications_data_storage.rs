use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(r#"
UPDATE "user"
SET preferences = jsonb_set(preferences, '{notifications}', v.new_notifications)
FROM (
    SELECT id, jsonb_agg(elem) FILTER (WHERE elem IS NOT NULL) AS new_notifications
    FROM "user",
    LATERAL (
        VALUES
            (CASE WHEN (preferences -> 'notifications' ->> 'media_published')::boolean THEN 'MetadataPublished' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'status_changed')::boolean THEN 'MetadataStatusChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'release_date_changed')::boolean THEN 'MetadataReleaseDateChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'number_of_seasons_changed')::boolean THEN 'MetadataNumberOfSeasonsChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'episode_released')::boolean THEN 'MetadataEpisodeReleased' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'episode_name_changed')::boolean THEN 'MetadataEpisodeNameChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'number_of_chapters_or_episodes_changed')::boolean THEN 'MetadataChaptersOrEpisodesChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'episode_images_changed')::boolean THEN 'MetadataEpisodeImagesChanged' END),
            (CASE WHEN (preferences -> 'notifications' ->> 'new_review_posted')::boolean THEN 'PersonMediaAssociated' END)
    ) AS sub(elem)
    GROUP BY id
) AS v
WHERE "user".id = v.id;
        "#).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
