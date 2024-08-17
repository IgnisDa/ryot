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
            "#,
        )
        .await?;
        if manager.has_column("integration", "source").await? {
            db.execute_unprepared(
                r#"ALTER TABLE "integration" RENAME COLUMN "source" TO "provider""#,
            )
            .await?;
        }
        if manager
            .has_column("integration", "source_specifics")
            .await?
        {
            db.execute_unprepared(
                r#"ALTER TABLE "integration" RENAME COLUMN "source_specifics" TO "provider_specifics""#,
            )
            .await?;
        }
        db.execute_unprepared(
            r#"
ALTER TABLE "metadata" ADD COLUMN IF NOT EXISTS "external_identifiers" jsonb;
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
ALTER TABLE "collection_to_entity" ADD COLUMN IF NOT EXISTS "system_information" jsonb not null default '{}';
            "#,
        )
        .await?;
        db.execute_unprepared(
            r#"
UPDATE "user_to_entity" SET "needs_to_be_updated" = TRUE WHERE 'finished' = ANY("media_reason");
            "#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
