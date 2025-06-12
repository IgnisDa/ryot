use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Add total_person_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "total_person_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN total_person_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Add total_metadata_group_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "total_metadata_group_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN total_metadata_group_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Add person_collection_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "person_collection_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN person_collection_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Add metadata_collection_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "metadata_collection_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN metadata_collection_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Add metadata_group_collection_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "metadata_group_collection_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN metadata_group_collection_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Add total_collection_count column if it doesn't exist
        if !manager
            .has_column("daily_user_activity", "total_collection_count")
            .await?
        {
            db.execute_unprepared(
                "ALTER TABLE daily_user_activity ADD COLUMN total_collection_count INTEGER NOT NULL DEFAULT 0;"
            ).await?;
        }

        // Delete all existing records since counting logic will change
        db.execute_unprepared("DELETE FROM daily_user_activity;")
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
