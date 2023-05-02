use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Metadata;

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum VideoGameSource {
    #[sea_orm(string_value = "I")]
    Igdb,
}

#[derive(Iden)]
pub enum VideoGame {
    Table,
    MetadataId,
    IgdbId,
    Source,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230502_000008_create_video_game"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(VideoGame::Table)
                    .col(
                        ColumnDef::new(VideoGame::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("video_game_to_metadata_foreign_key")
                            .from(VideoGame::Table, VideoGame::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(VideoGame::IgdbId).string().not_null())
                    .col(
                        ColumnDef::new(VideoGame::Source)
                            .enumeration(
                                VideoGameSourceEnum.into_iden(),
                                VideoGameSourceEnum.into_iter(),
                            )
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("video_game__imdb__index")
                    .table(VideoGame::Table)
                    .col(VideoGame::IgdbId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(VideoGame::Table).to_owned())
            .await?;
        Ok(())
    }
}
