use sea_orm_migration::prelude::*;

use crate::migrator::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum CalendarEvent {
    Table,
    Id,
    Date,
    MetadataId,
    // stores the `season` and `episode` numbers
    MetadataExtraInformation,
}

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
                    // DEV: We use string to avoid problems since json does not
                    // allow index. I could have used JSONB but no MySQL support.
                    .col(ColumnDef::new(CalendarEvent::MetadataExtraInformation).string())
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
                    .name("calendar_event-date-metadataid-info__uq-idx")
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
