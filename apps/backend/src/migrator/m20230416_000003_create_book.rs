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
pub enum BookSource {
    #[sea_orm(string_value = "O")]
    OpenLibrary,
    #[sea_orm(string_value = "G")]
    Goodreads,
}

#[derive(Iden)]
pub enum Book {
    Table,
    MetadataId,
    Identifier,
    NumPages,
    Source,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230416_000003_create_book"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Book::Table)
                    .col(
                        ColumnDef::new(Book::MetadataId)
                            .integer()
                            .primary_key()
                            .unique_key()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("book_to_metadata_foreign_key")
                            .from(Book::Table, Book::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Book::Identifier).string().not_null())
                    .col(ColumnDef::new(Book::NumPages).integer())
                    .col(ColumnDef::new(Book::Source).string_len(1).not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("book__openlibrary__index")
                    .table(Book::Table)
                    .col(Book::Identifier)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Book::Table).to_owned())
            .await?;
        Ok(())
    }
}
