use sea_orm_migration::prelude::*;

use crate::SeenState;

use super::{m20230410_create_metadata::Metadata, m20230417_create_user::User};

pub static TOTAL_TIME_SPENT_COLUMN_EXTRA_SQL: &str = "GENERATED ALWAYS AS (CASE WHEN array_length(updated_at, 1) < 2 THEN NULL ELSE EXTRACT(EPOCH FROM (updated_at[array_length(updated_at, 1)] - updated_at[1])) END) STORED";

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum Seen {
    Table,
    Id,
    Progress,
    StartedOn,
    FinishedOn,
    State,
    UserId,
    MetadataId,
    LastUpdatedOn,
    UpdatedAt,
    NumTimesUpdated,
    ShowExtraInformation,
    PodcastExtraInformation,
    AnimeExtraInformation,
    MangaExtraInformation,
    ProviderWatchedOn,
    TotalTimeSpent,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Seen::Table)
                    .col(
                        ColumnDef::new(Seen::Id)
                            .primary_key()
                            .auto_increment()
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Seen::Progress)
                            .decimal()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Seen::StartedOn).date())
                    .col(ColumnDef::new(Seen::FinishedOn).date())
                    .col(ColumnDef::new(Seen::UserId).integer().not_null())
                    .col(ColumnDef::new(Seen::MetadataId).integer().not_null())
                    .col(
                        ColumnDef::new(Seen::State)
                            .text()
                            .not_null()
                            .default(SeenState::InProgress),
                    )
                    .col(
                        ColumnDef::new(Seen::UpdatedAt)
                            .array(ColumnType::TimestampWithTimeZone)
                            .not_null()
                            .extra("DEFAULT ARRAY[CURRENT_TIMESTAMP]"),
                    )
                    .col(
                        ColumnDef::new(Seen::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .extra("GENERATED ALWAYS AS (updated_at[array_length(updated_at, 1)]) STORED")
                    )
                    .col(
                        ColumnDef::new(Seen::NumTimesUpdated)
                            .integer()
                            .not_null()
                            .extra("GENERATED ALWAYS AS (array_length(updated_at, 1)) STORED")
                    )
                    .col(ColumnDef::new(Seen::ShowExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::PodcastExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::AnimeExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::MangaExtraInformation).json_binary())
                    .foreign_key(
                        ForeignKey::create()
                            .name("user_to_seen_foreign_key")
                            .from(Seen::Table, Seen::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("metadata_to_seen_foreign_key")
                            .from(Seen::Table, Seen::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Seen::ProviderWatchedOn).text())
                    .col(
                        ColumnDef::new(Seen::TotalTimeSpent)
                            .integer()
                            .extra(TOTAL_TIME_SPENT_COLUMN_EXTRA_SQL)
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
