use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
-- collection table
ALTER TABLE collection ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE collection ALTER COLUMN last_updated_on TYPE timestamp;

-- collection_to_entity table
ALTER TABLE collection_to_entity ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE collection_to_entity ALTER COLUMN last_updated_on TYPE timestamp;

-- import_report table
ALTER TABLE import_report ALTER COLUMN finished_on TYPE timestamp;
ALTER TABLE import_report ALTER COLUMN started_on TYPE timestamp;

-- integration table
ALTER TABLE integration ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE integration ALTER COLUMN last_triggered_on TYPE timestamp;

-- metadata table
ALTER TABLE metadata ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE metadata ALTER COLUMN last_updated_on TYPE timestamp;

-- notification_platform table
ALTER TABLE notification_platform ALTER COLUMN created_on TYPE timestamp;

-- person table
ALTER TABLE person ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE person ALTER COLUMN last_updated_on TYPE timestamp;

-- review table
ALTER TABLE review ALTER COLUMN posted_on TYPE timestamp;

-- seen table
ALTER TABLE seen ALTER COLUMN last_updated_on TYPE timestamp;

-- user table
ALTER TABLE "user" ALTER COLUMN created_on TYPE timestamp;

-- user_measurement table
ALTER TABLE user_measurement ALTER COLUMN "timestamp" TYPE timestamp;

-- user_summary table
ALTER TABLE user_summary ALTER COLUMN calculated_on TYPE timestamp;

-- user_to_entity table
ALTER TABLE user_to_entity ALTER COLUMN created_on TYPE timestamp;
ALTER TABLE user_to_entity ALTER COLUMN last_updated_on TYPE timestamp;

-- workout table
ALTER TABLE workout ALTER COLUMN end_time TYPE timestamp;
ALTER TABLE workout ALTER COLUMN start_time TYPE timestamp;
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
