use sea_orm_migration::prelude::*;

use super::m20230912_create_calendar_event::UNIQUE_KEY;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager
            .has_column("calendar_event", "metadata_extra_information")
            .await?
        {
            let db = manager.get_connection();
            db.execute_unprepared(
               &format!(r#"
ALTER TABLE calendar_event ADD COLUMN metadata_show_extra_information JSONB;
ALTER TABLE calendar_event ADD COLUMN metadata_podcast_extra_information JSONB;

UPDATE calendar_event SET metadata_show_extra_information = metadata_extra_information -> 'Show' WHERE metadata_extra_information -> 'Show' IS NOT NULL;
UPDATE calendar_event SET metadata_podcast_extra_information = metadata_extra_information -> 'Podcast' WHERE metadata_extra_information -> 'Podcast' IS NOT NULL;

DROP INDEX "{uq_key}";
ALTER TABLE calendar_event DROP COLUMN metadata_extra_information;
CREATE UNIQUE INDEX "{uq_key}" ON calendar_event (date, metadata_id, metadata_show_extra_information, metadata_podcast_extra_information);
"#, uq_key = UNIQUE_KEY),
)
.await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
