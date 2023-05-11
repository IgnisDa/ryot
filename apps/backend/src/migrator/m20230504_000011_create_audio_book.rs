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
pub enum AudioBookSource {
    #[sea_orm(string_value = "A")]
    Audible,
}

#[derive(Iden)]
pub enum AudioBook {
    Table,
    MetadataId,
    Identifier,
    Runtime,
    Source,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230504_000011_create_audio_book"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AudioBook::Table)
                    .col(
                        ColumnDef::new(AudioBook::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("audio_book_to_metadata_foreign_key")
                            .from(AudioBook::Table, AudioBook::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(AudioBook::Identifier).string().not_null())
                    .col(ColumnDef::new(AudioBook::Runtime).integer())
                    .col(ColumnDef::new(AudioBook::Source).string_len(1).not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("audio_book__audibleid__index")
                    .table(AudioBook::Table)
                    .col(AudioBook::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AudioBook::Table).to_owned())
            .await?;
        Ok(())
    }
}
