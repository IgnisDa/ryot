use sea_orm_migration::prelude::*;

use super::m20230417_create_user::User;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum ImportReport {
    Table,
    Id,
    UserId,
    StartedOn,
    FinishedOn,
    Source,
    Details,
    Success,
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
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ImportReport::Source)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(ColumnDef::new(ImportReport::UserId).integer().not_null())
                    .col(
                        ColumnDef::new(ImportReport::StartedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(ImportReport::FinishedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(ImportReport::Details).json_binary())
                    .col(ColumnDef::new(ImportReport::Success).boolean())
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
