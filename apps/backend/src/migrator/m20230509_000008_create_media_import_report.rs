use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::m20230417_000002_create_user::User;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        // FIXME: Remove media from name
        "m20230509_000008_create_media_import_report"
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum ImportSource {
    #[sea_orm(string_value = "MJ")]
    MediaJson,
    #[sea_orm(string_value = "MT")]
    MediaTracker,
    #[sea_orm(string_value = "GO")]
    Goodreads,
    #[sea_orm(string_value = "TR")]
    Trakt,
    #[sea_orm(string_value = "MO")]
    Movary,
    #[sea_orm(string_value = "ST")]
    StoryGraph,
}

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
                    .col(ColumnDef::new(ImportReport::Details).json())
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
