use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Metadata;

pub struct Migration;

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize, Enum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum PodcastSource {
    #[sea_orm(string_value = "L")]
    Listennotes,
}

#[derive(Iden)]
pub enum Podcast {
    Table,
    MetadataId,
    Details,
    Source,
    TotalEpisodes,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230514_000015_create_podcast"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Podcast::Table)
                    .col(
                        ColumnDef::new(Podcast::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("podcast_to_metadata_foreign_key")
                            .from(Podcast::Table, Podcast::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Podcast::Details).not_null().json())
                    .col(ColumnDef::new(Podcast::Source).string_len(1).not_null())
                    .col(ColumnDef::new(Podcast::TotalEpisodes).integer().not_null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Podcast::Table).to_owned())
            .await?;
        Ok(())
    }
}
