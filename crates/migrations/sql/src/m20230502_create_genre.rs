use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static GENRE_NAME_TRIGRAM_INDEX: &str = "genre_name_trigram_idx";

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

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Genre::Table)
                    .col(ColumnDef::new(Genre::Id).text().not_null().primary_key())
                    .col(ColumnDef::new(Genre::Name).text().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToGenre::Table)
                    .col(ColumnDef::new(MetadataToGenre::GenreId).text().not_null())
                    .col(
                        ColumnDef::new(MetadataToGenre::MetadataId)
                            .text()
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

        let db = manager.get_connection();
        db.execute_unprepared(&format!(
            r#"CREATE INDEX "{GENRE_NAME_TRIGRAM_INDEX}" ON genre USING gin (name gin_trgm_ops);"#
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
