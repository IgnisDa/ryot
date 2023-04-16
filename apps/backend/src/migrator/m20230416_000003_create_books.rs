use sea_orm_migration::prelude::*;

use super::m20230410_000002_create_metadata::MediaItemMetadata;

static BOOK_TO_METADATA_FOREIGN_KEY: &str = "book_to_metadata_foreign_key";
static OPENLIBRARY_KEY_TO_BOOK_FOREIGN_KEY: &str = "openlibrary_key_to_book_foreign_key";

pub struct Migration;

#[derive(Iden)]
enum OpenLibraryKey {
    Table,
    Id,
    Key,
}

#[derive(Iden)]
pub enum Book {
    Table,
    MetadataId,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230416_000003_create_books"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(OpenLibraryKey::Table)
                    .col(
                        ColumnDef::new(OpenLibraryKey::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(OpenLibraryKey::Key).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name(OPENLIBRARY_KEY_TO_BOOK_FOREIGN_KEY)
                            .from(OpenLibraryKey::Table, OpenLibraryKey::Id)
                            .to(Book::Table, Book::MetadataId)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
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
                            .name(BOOK_TO_METADATA_FOREIGN_KEY)
                            .from(Book::Table, Book::MetadataId)
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
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
        manager
            .drop_table(Table::drop().table(OpenLibraryKey::Table).to_owned())
            .await?;
        Ok(())
    }
}
