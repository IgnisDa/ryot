use sea_orm_migration::prelude::*;

use super::Metadata;

pub struct Migration;

#[derive(Iden)]
pub enum Book {
    Table,
    MetadataId,
    OpenLibraryKeys,
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
                    .col(
                        ColumnDef::new(Book::OpenLibraryKeys)
                            .json()
                            .default("[]")
                            .not_null(),
                    )
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
