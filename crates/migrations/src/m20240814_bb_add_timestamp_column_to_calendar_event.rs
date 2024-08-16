use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !manager.has_column("calendar_event", "timestamp").await? {
            db.execute_unprepared(&format!(
                r#"
ALTER TABLE "calendar_event" ADD COLUMN "timestamp" timestamp without time zone;
UPDATE "calendar_event" SET "timestamp" = "date";
ALTER TABLE "calendar_event" ALTER COLUMN "timestamp" SET NOT NULL;
ALTER TABLE "calendar_event" DROP COLUMN "date";
ALTER TABLE "calendar_event" ADD COLUMN "date" date GENERATED ALWAYS AS (DATE("timestamp")) STORED;
DROP INDEX IF EXISTS "{idx}";
CREATE UNIQUE INDEX "{idx}" ON "calendar_event"
("timestamp", "metadata_id", "metadata_show_extra_information", "metadata_podcast_extra_information", "metadata_anime_extra_information") NULLS NOT DISTINCT;
;
"#,
                idx = super::m20230912_create_calendar_event::UNIQUE_KEY
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
