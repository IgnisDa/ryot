use async_graphql::Enum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::Metadata;

pub struct Migration;

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum MovieSource {
    #[default]
    #[sea_orm(string_value = "T")]
    Tmdb,
}

#[derive(Iden)]
pub enum Movie {
    Table,
    MetadataId,
    // the total time of the movie in minutes
    Runtime,
    Source,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230423_000006_create_movie"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Movie::Table)
                    .col(
                        ColumnDef::new(Movie::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("movie_to_metadata_foreign_key")
                            .from(Movie::Table, Movie::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Movie::Runtime).integer())
                    .col(ColumnDef::new(Movie::Source).string_len(1).not_null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
