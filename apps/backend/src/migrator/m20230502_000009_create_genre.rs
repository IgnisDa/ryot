use sea_orm_migration::prelude::*;

use super::Metadata;

pub struct Migration;

#[derive(Iden)]
pub enum MetadataToGenre {
    Table,
    MetadataId,
    GenreId,
}

#[derive(Iden)]
pub enum Genre {
    Table,
    Id,
    Name,
}

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20230502_000009_create_genre"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Genre::Table)
                    .col(
                        ColumnDef::new(Genre::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Genre::Name).string().unique_key().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("genre_name_index")
                    .table(Genre::Table)
                    .col(Genre::Name)
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToGenre::Table)
                    .col(
                        ColumnDef::new(MetadataToGenre::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToGenre::GenreId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-metadata_genre")
                            .col(MetadataToGenre::MetadataId)
                            .col(MetadataToGenre::GenreId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_id-genre_id")
                            .from(MetadataToGenre::Table, MetadataToGenre::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-genre_id-metadata_id")
                            .from(MetadataToGenre::Table, MetadataToGenre::GenreId)
                            .to(Genre::Table, Genre::Id)
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
            .drop_table(Table::drop().table(MetadataToGenre::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Genre::Table).to_owned())
            .await?;
        Ok(())
    }
}
