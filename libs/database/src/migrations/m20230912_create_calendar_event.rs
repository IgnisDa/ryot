use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum CalendarEvent {
    Table,
    Id,
    Date,
    MetadataId,
    MetadataShowExtraInformation,
    MetadataPodcastExtraInformation,
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
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CalendarEvent::Date).date().not_null())
                    .col(ColumnDef::new(CalendarEvent::MetadataShowExtraInformation).json_binary())
                    .col(
                        ColumnDef::new(CalendarEvent::MetadataPodcastExtraInformation)
                            .json_binary(),
                    )
                    .col(ColumnDef::new(CalendarEvent::MetadataId).integer())
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
                    .col(CalendarEvent::Date)
                    .col(CalendarEvent::MetadataId)
                    .col(CalendarEvent::MetadataShowExtraInformation)
                    .col(CalendarEvent::MetadataPodcastExtraInformation)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
