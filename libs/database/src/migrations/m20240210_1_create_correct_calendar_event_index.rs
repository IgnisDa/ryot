use sea_orm_migration::prelude::*;

use super::m20230912_create_calendar_event::{CalendarEvent, UNIQUE_KEY};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name(UNIQUE_KEY)
                    .table(CalendarEvent::Table)
                    .to_owned(),
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
                    .col(CalendarEvent::MetadataShowExtraInformation)
                    .col(CalendarEvent::MetadataPodcastExtraInformation)
                    .nulls_not_distinct()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
