use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::m20230417_000004_create_user::User;

pub struct Migration;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MediaImportSource {
    #[sea_orm(string_value = "MT")]
    MediaTracker,
    #[sea_orm(string_value = "GO")]
    Goodreads,
}

#[derive(Iden)]
pub enum MediaImportReport {
    Table,
    Id,
    UserId,
    StartedOn,
    FinishedOn,
    Source,
    Details,
    Success,
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
                        ColumnDef::new(MediaImportReport::Source)
                            .string_len(2)
                            .not_null(),
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
                    .col(ColumnDef::new(MediaImportReport::FinishedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(MediaImportReport::Details).json())
                    .col(ColumnDef::new(MediaImportReport::Success).boolean())
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
