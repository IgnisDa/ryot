use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum CalendarEvent {
    Table,
    Id,
    // Always stored in UTC
    Timestamp,
    Date,
    MetadataId,
    MetadataShowExtraInformation,
    MetadataPodcastExtraInformation,
    MetadataAnimeExtraInformation,
}

pub static UNIQUE_KEY: &str = "calendar_event-date-metadataid-info__uq-idx";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CalendarEvent::Table)
                    .col(
                        ColumnDef::new(CalendarEvent::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CalendarEvent::MetadataShowExtraInformation).json_binary())
                    .col(
                        ColumnDef::new(CalendarEvent::MetadataPodcastExtraInformation)
                            .json_binary(),
                    )
                    .col(ColumnDef::new(CalendarEvent::MetadataId).text())
                    .col(ColumnDef::new(CalendarEvent::MetadataAnimeExtraInformation).json_binary())
                    .col(
                        ColumnDef::new(CalendarEvent::Timestamp)
                            .timestamp()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CalendarEvent::Date)
                            .date()
                            .not_null()
                            .extra(r#"GENERATED ALWAYS AS (DATE("timestamp")) STORED"#),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-calendar_event_to_metadata")
                            .from(CalendarEvent::Table, CalendarEvent::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(UNIQUE_KEY)
                    .table(CalendarEvent::Table)
                    .col(CalendarEvent::Timestamp)
                    .col(CalendarEvent::MetadataId)
                    .col(CalendarEvent::MetadataShowExtraInformation)
                    .col(CalendarEvent::MetadataPodcastExtraInformation)
                    .col(CalendarEvent::MetadataAnimeExtraInformation)
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
