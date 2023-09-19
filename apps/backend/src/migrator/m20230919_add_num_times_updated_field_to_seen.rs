use sea_orm_migration::prelude::*;

use super::Seen;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_column("seen", "num_times_updated").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(Seen::Table)
                        .add_column(ColumnDef::new(Seen::NumTimesUpdated).integer())
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
