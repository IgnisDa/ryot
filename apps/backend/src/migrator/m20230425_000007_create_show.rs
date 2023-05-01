use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Metadata;

static SHOW_TMDB_ID_INDEX: &str = "show__tmdbid__index";

pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(Some(1))")]
pub enum ShowSource {
    #[sea_orm(string_value = "T")]
    Tmdb,
}

#[derive(Iden)]
pub enum Show {
    Table,
    TmdbId,
    MetadataId,
    Details,
    Source,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230425_000007_create_show"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Show::Table)
                    .col(ColumnDef::new(Show::TmdbId).string().not_null())
                    .col(
                        ColumnDef::new(Show::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Show::Details)
                            .not_null()
                            .json()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(Show::Source)
                            .enumeration(ShowSourceEnum.into_iden(), ShowSourceEnum.into_iter())
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("season_to_metadata_foreign_key")
                            .from(Show::Table, Show::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name(SHOW_TMDB_ID_INDEX)
                    .table(Show::Table)
                    .col(Show::TmdbId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Show::Table).to_owned())
            .await?;
        Ok(())
    }
}
