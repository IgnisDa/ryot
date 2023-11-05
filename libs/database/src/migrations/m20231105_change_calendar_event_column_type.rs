use sea_orm_migration::prelude::*;

use super::m20230912_create_calendar_event::{CalendarEvent, UNIQUE_KEY};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
alter table calendar_event add column temp_json jsonb;
update calendar_event set temp_json = metadata_extra_information::jsonb;
alter table calendar_event drop column metadata_extra_information;
alter table calendar_event rename column temp_json to metadata_extra_information;
update calendar_event set metadata_extra_information = '{"Other":null}' where metadata_extra_information = '"Other"';
"#,
        )
        .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(UNIQUE_KEY)
                    .table(CalendarEvent::Table)
                    .col(CalendarEvent::Date)
                    .col(CalendarEvent::MetadataId)
                    .col(CalendarEvent::MetadataExtraInformation)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
