use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        // Check if the new column already exists
        if manager.has_column("seen", "providers_consumed_on").await? {
            return Ok(());
        }

        // Add the new providers_consumed_on column as text array with empty array default
        db.execute_unprepared(
            "ALTER TABLE seen ADD COLUMN providers_consumed_on text[] NOT NULL DEFAULT ARRAY[]::text[]"
        ).await?;

        // Migrate existing data: if provider_watched_on has a value, add it to the array
        db.execute_unprepared(
            "UPDATE seen SET providers_consumed_on = CASE
                WHEN provider_watched_on IS NOT NULL THEN ARRAY[provider_watched_on]
                ELSE ARRAY[]::text[]
            END",
        )
        .await?;

        // Drop the old column
        db.execute_unprepared("ALTER TABLE seen DROP COLUMN provider_watched_on")
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
