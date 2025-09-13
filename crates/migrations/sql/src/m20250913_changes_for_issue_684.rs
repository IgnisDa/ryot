use sea_orm_migration::prelude::*;

use crate::m20250827_create_enriched_user_to_entity_views::{
    ENRICHED_USER_TO_EXERCISE_VIEW_CREATION_SQL, ENRICHED_USER_TO_METADATA_GROUP_VIEW_CREATION_SQL,
    ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL, ENRICHED_USER_TO_PERSON_VIEW_CREATION_SQL,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(r#"DROP VIEW IF EXISTS "enriched_user_to_exercise""#)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_EXERCISE_VIEW_CREATION_SQL)
            .await?;

        db.execute_unprepared(r#"DROP VIEW IF EXISTS "enriched_user_to_person""#)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_PERSON_VIEW_CREATION_SQL)
            .await?;

        db.execute_unprepared(r#"DROP VIEW IF EXISTS "enriched_user_to_metadata_group""#)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_METADATA_GROUP_VIEW_CREATION_SQL)
            .await?;

        db.execute_unprepared(r#"DROP VIEW IF EXISTS "enriched_user_to_metadata""#)
            .await?;
        db.execute_unprepared(ENRICHED_USER_TO_METADATA_VIEW_CREATION_SQL)
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
