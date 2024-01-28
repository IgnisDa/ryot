use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(r#"
-- Step 1: Create a temporary table for Anime
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
AND s.id NOT IN (
    SELECT s2.id
    FROM seen s2
    WHERE s2.metadata_id = m.id
    AND s2.extra_information IS NOT NULL
);

-- Step 2: Insert the new seen records for Anime
INSERT INTO seen (progress, started_on, finished_on, user_id, metadata_id, state, extra_information, updated_at)
SELECT progress, started_on, finished_on, user_id, metadata_id, state, extra_information, updated_at
FROM temp_episode_entries;

-- Step 3: Delete the original seen records for Anime
DELETE FROM seen
WHERE id IN (
    SELECT original_seen_id
    FROM temp_episode_entries
);

-- Step 4: Drop the temporary table for Anime
DROP TABLE temp_episode_entries;

-- Update seen entries for Anime with null extra_information
UPDATE seen s
SET extra_information = jsonb_build_object('Anime', jsonb_build_object('episode', NULL))
FROM metadata m
WHERE s.metadata_id = m.id
AND m.lot = 'AN'
AND s.extra_information IS NULL;
        "#)
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
