use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_column("metadata", "is_specifics_partial")
            .await?
        {
            manager
                .alter_table(
                    TableAlterStatement::new()
                        .table(Metadata::Table)
                        .add_column(
                            ColumnDef::new(Metadata::IsSpecificsPartial)
                                .boolean()
                                .not_null()
                                .generated(
                                    Expr::expr(Expr::col(Metadata::AnimeSpecifics).is_null())
                                        .and(Expr::col(Metadata::AnimeSpecifics).is_null())
                                        .and(Expr::col(Metadata::AudioBookSpecifics).is_null())
                                        .and(Expr::col(Metadata::BookSpecifics).is_null())
                                        .and(Expr::col(Metadata::MangaSpecifics).is_null())
                                        .and(Expr::col(Metadata::MovieSpecifics).is_null())
                                        .and(Expr::col(Metadata::PodcastSpecifics).is_null())
                                        .and(Expr::col(Metadata::ShowSpecifics).is_null())
                                        .and(Expr::col(Metadata::VideoGameSpecifics).is_null())
                                        .and(Expr::col(Metadata::VisualNovelSpecifics).is_null())
                                        .and(Expr::col(Metadata::MusicSpecifics).is_null()),
                                    true,
                                ),
                        )
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
