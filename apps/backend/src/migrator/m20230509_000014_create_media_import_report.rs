use sea_orm_migration::prelude::*;

use super::m20230417_000004_create_user::User;

pub struct Migration;

#[derive(Iden)]
pub enum MediaImportReport {
    Table,
    Id,
    UserId,
    StartedOn,
    FinishedOn,
    Total,
    Failed,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230509_000014_create_media_import_report"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(MediaImportReport::Table)
                    .col(
                        ColumnDef::new(MediaImportReport::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(MediaImportReport::UserId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MediaImportReport::StartedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(MediaImportReport::Failed).json())
                    .col(ColumnDef::new(MediaImportReport::FinishedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(MediaImportReport::Total).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("media_import_report_to_user_foreign_key")
                            .from(MediaImportReport::Table, MediaImportReport::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(MediaImportReport::Table).to_owned())
            .await?;
        Ok(())
    }
}
