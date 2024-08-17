use std::env;

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let maximum = env::var("INTEGRATION_MAXIMUM_PROGRESS_LIMIT").unwrap_or("95".to_string());
        let minimum = env::var("INTEGRATION_MINIMUM_PROGRESS_LIMIT").unwrap_or("2".to_string());
        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "minimum_progress" DECIMAL NOT NULL DEFAULT {};
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "maximum_progress" DECIMAL NOT NULL DEFAULT {};
ALTER TABLE "integration" ALTER COLUMN "minimum_progress" DROP DEFAULT;
ALTER TABLE "integration" ALTER COLUMN "maximum_progress" DROP DEFAULT;
            "#,
            minimum, maximum
        ))
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
