use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("seen", "extra_information").await? {
            let db = manager.get_connection();
            db.execute_unprepared(r#"
CREATE TEMP TABLE temp_episode_entries AS
SELECT s.id AS original_seen_id, s.progress, s.started_on, s.finished_on, s.user_id,
       m.id AS metadata_id, s.state,
       jsonb_build_object('Anime', jsonb_build_object('episode', ep.episode)) AS extra_information,
       s.updated_at
FROM seen s
JOIN metadata m ON s.metadata_id = m.id
CROSS JOIN LATERAL generate_series(1, NULLIF((m.specifics::jsonb #>> '{d,episodes}')::integer, 0)) AS ep(episode)
WHERE m.specifics::jsonb ->> 't' = 'Anime'
AND m.specifics::jsonb #>> '{d,episodes}' IS NOT NULL
AND s.state != 'IP'
AND s.id NOT IN (
    SELECT s2.id
    FROM seen s2
    WHERE s2.metadata_id = m.id
    AND s2.extra_information IS NOT NULL
);

INSERT INTO seen (progress, started_on, finished_on, user_id, metadata_id, state, extra_information, updated_at)
SELECT progress, started_on, finished_on, user_id, metadata_id, state, extra_information, updated_at
FROM temp_episode_entries;

DELETE FROM seen
WHERE id IN (
    SELECT original_seen_id
    FROM temp_episode_entries
);

DROP TABLE temp_episode_entries;

UPDATE seen s
SET extra_information = jsonb_build_object('Anime', jsonb_build_object('episode', NULL))
FROM metadata m
WHERE s.metadata_id = m.id
AND m.lot = 'AN'
AND s.extra_information IS NULL;
        "#)
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
