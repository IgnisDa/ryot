use sea_orm_migration::prelude::*;

use super::m20230419_create_seen::Seen;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if manager.has_column("seen", "last_updated_on").await? {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Seen::Table)
                        .drop_column(Alias::new("last_updated_on"))
                        .to_owned(),
                )
                .await?;
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Seen::Table)
                        .add_column(
                            ColumnDef::new(Seen::UpdatedAt)
                                .array(ColumnType::TimestampWithTimeZone)
                                .default("{}")
                                .not_null(),
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
