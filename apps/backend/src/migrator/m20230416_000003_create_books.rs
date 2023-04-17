use sea_orm_migration::prelude::*;

use super::MediaItemMetadata;

pub struct Migration;

#[derive(Iden)]
enum BookOpenLibraryKey {
    Table,
    BookId,
    OpenLibraryKeyId,
}

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
                    .table(BookOpenLibraryKey::Table)
                    .col(
                        ColumnDef::new(BookOpenLibraryKey::BookId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(BookOpenLibraryKey::OpenLibraryKeyId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-book_openlibrary-key")
                            .col(BookOpenLibraryKey::BookId)
                            .col(BookOpenLibraryKey::OpenLibraryKeyId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-book_book-openlibrary-key_id")
                            .from(BookOpenLibraryKey::Table, BookOpenLibraryKey::BookId)
                            .to(Book::Table, Book::MetadataId)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-openlibrary-key_book-openlibrary-key_id")
                            .from(
                                BookOpenLibraryKey::Table,
                                BookOpenLibraryKey::OpenLibraryKeyId,
                            )
                            .to(OpenLibraryKey::Table, OpenLibraryKey::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
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
                            .name("openlibrary_key_to_book_foreign_key")
                            .from(OpenLibraryKey::Table, OpenLibraryKey::Id)
                            .to(Book::Table, Book::MetadataId)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
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
                            .name("book_to_metadata_foreign_key")
                            .from(Book::Table, Book::MetadataId)
                            .to(MediaItemMetadata::Table, MediaItemMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
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
        manager
            .drop_table(Table::drop().table(BookOpenLibraryKey::Table).to_owned())
            .await?;
        Ok(())
    }
}
