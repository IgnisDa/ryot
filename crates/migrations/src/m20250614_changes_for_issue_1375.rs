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
            ",
        )
        .await?;

        // Convert finished_on column from date to timestamptz
        db.execute_unprepared(
            "
ALTER TABLE seen ALTER COLUMN finished_on TYPE timestamptz USING finished_on::timestamptz;
            ",
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
