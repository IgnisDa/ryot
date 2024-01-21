use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("seen", "updated_at").await? {
            let db = manager.get_connection();
            db.execute_unprepared(
                r"
ALTER TABLE seen ADD COLUMN updated_at timestamptz[] DEFAULT ARRAY[CURRENT_TIMESTAMP] NOT NULL;
UPDATE seen SET updated_at = ARRAY[last_updated_on];
ALTER TABLE seen
    DROP COLUMN last_updated_on,
    DROP COLUMN num_times_updated;
                ",
            )
            .await?;
            db.execute_unprepared(
                r"
ALTER TABLE seen
    ADD COLUMN last_updated_on timestamptz GENERATED ALWAYS AS (updated_at[array_length(updated_at, 1)]) STORED NOT NULL,
    ADD COLUMN num_times_updated integer GENERATED ALWAYS AS (array_length(updated_at, 1)) STORED NOT NULL;
                ",
            )
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
