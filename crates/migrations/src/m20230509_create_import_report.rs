use sea_orm_migration::prelude::*;

use super::m20230404_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum ImportReport {
    Id,
    Table,
    UserId,
    Source,
    Details,
    Progress,
    StartedOn,
    FinishedOn,
    WasSuccess,
    SourceResult,
    EstimatedFinishTime,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ImportReport::Table)
                    .col(
                        ColumnDef::new(ImportReport::Id)
                            .text()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ImportReport::Source).text().not_null())
                    .col(
                        ColumnDef::new(ImportReport::StartedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(ImportReport::FinishedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(ImportReport::WasSuccess).boolean())
                    .col(ColumnDef::new(ImportReport::Details).json_binary())
                    .col(ColumnDef::new(ImportReport::UserId).text().not_null())
                    .col(ColumnDef::new(ImportReport::Progress).decimal())
                    .col(ColumnDef::new(ImportReport::SourceResult).json_binary())
                    .col(
                        ColumnDef::new(ImportReport::EstimatedFinishTime)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("media_import_report_to_user_foreign_key")
                            .from(ImportReport::Table, ImportReport::UserId)
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
