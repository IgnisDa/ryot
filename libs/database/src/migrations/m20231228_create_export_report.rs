use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum ExportReport {
    Table,
    Id,
    UserId,
    StartedOn,
    FinishedOn,
    Details,
    Success,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ExportReport::Table)
                    .col(
                        ColumnDef::new(ExportReport::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ExportReport::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(ExportReport::StartedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(ExportReport::FinishedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(ExportReport::Details).json_binary())
                    .col(ColumnDef::new(ExportReport::Success).boolean())
                    .foreign_key(
                        ForeignKey::create()
                            .from(ExportReport::Table, ExportReport::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
