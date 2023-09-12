use sea_orm_migration::prelude::*;

use super::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("metadata", "last_processed_on_for_calendar")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(Metadata::Table)
                        .add_column(
                            ColumnDef::new(Metadata::LastProcessedOnForCalendar)
                                .timestamp_with_time_zone(),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
