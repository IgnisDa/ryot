use sea_orm_migration::prelude::*;

use super::m20231016_create_collection_to_entity::CONSTRAINT_SQL;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(CONSTRAINT_SQL).await?;
        db.execute_unprepared(
            r#"
ALTER TABLE collection_to_entity
ADD COLUMN IF NOT EXISTS entity_id text GENERATED ALWAYS AS (
    COALESCE(metadata_id,
             person_id,
             metadata_group_id,
             exercise_id,
             workout_id)
) STORED;
        "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE collection_to_entity
ADD COLUMN IF NOT EXISTS entity_lot text GENERATED ALWAYS AS (
    CASE
        WHEN metadata_id IS NOT NULL THEN 'metadata'
        WHEN person_id IS NOT NULL THEN 'person'
        WHEN metadata_group_id IS NOT NULL THEN 'metadata_group'
        WHEN exercise_id IS NOT NULL THEN 'exercise'
        WHEN workout_id IS NOT NULL THEN 'workout'
    END
) STORED;
        "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
