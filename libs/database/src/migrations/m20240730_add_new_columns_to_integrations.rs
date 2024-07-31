use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
UPDATE "user" SET preferences = JSONB_SET(preferences, '{general,disable_integrations}',
preferences->'general'->'disable_yank_integrations', true);
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "integration" ALTER COLUMN "minimum_progress" DROP NOT NULL;
ALTER TABLE "integration" ALTER COLUMN "maximum_progress" DROP NOT NULL;
ALTER TABLE "integration" ADD COLUMN IF NOT EXISTS "destination_specifics" jsonb;
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN IF NOT EXISTS "system_information" jsonb not null default '{}';
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
