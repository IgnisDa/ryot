use sea_orm_migration::prelude::*;

use enum_models::SeenState;

use super::{m20230404_create_user::User, m20230410_create_metadata::Metadata};

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
    // DEV: This column is created in the `create_review` migration
    ReviewId,
    LastUpdatedOn,
    UpdatedAt,
    NumTimesUpdated,
    ShowExtraInformation,
    PodcastExtraInformation,
    AnimeExtraInformation,
    MangaExtraInformation,
    ProviderWatchedOn,
    ManualTimeSpent,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Seen::Table)
                    .col(ColumnDef::new(Seen::Id).primary_key().text().not_null())
                    .col(
                        ColumnDef::new(Seen::Progress)
                            .decimal()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Seen::StartedOn).timestamp_with_time_zone())
                    .col(ColumnDef::new(Seen::FinishedOn).timestamp_with_time_zone())
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
                    .col(ColumnDef::new(Seen::ShowExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::PodcastExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::AnimeExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::MangaExtraInformation).json_binary())
                    .col(ColumnDef::new(Seen::ProviderWatchedOn).text())
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
                    .col(ColumnDef::new(Seen::MetadataId).text().not_null())
                    .col(ColumnDef::new(Seen::UserId).text().not_null())
                    .col(ColumnDef::new(Seen::ManualTimeSpent).decimal())
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
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
