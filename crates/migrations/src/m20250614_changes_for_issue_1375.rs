use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
UPDATE "metadata" SET "source" = 'myanimelist' where "source" = 'mal';
            "#,
        )
        .await?;

        // Convert started_on column from date to timestamptz
        db.execute_unprepared(
            "
ALTER TABLE seen ALTER COLUMN started_on TYPE timestamptz USING started_on::timestamptz;
UPDATE seen SET started_on = updated_at[1] WHERE started_on IS NOT NULL;
            ",
        )
        .await?;

        // Convert finished_on column from date to timestamptz
        db.execute_unprepared(
            "
ALTER TABLE seen ALTER COLUMN finished_on TYPE timestamptz USING finished_on::timestamptz;
UPDATE seen SET finished_on = updated_at[array_upper(updated_at, 1)] WHERE finished_on IS NOT NULL;
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
