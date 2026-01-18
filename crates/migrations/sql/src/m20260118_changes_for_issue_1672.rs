use sea_orm_migration::prelude::*;

use super::m20251128_create_entity_translation::EntityTranslation;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let table_name = "entity_translation";
        if !manager
            .has_column(table_name, "show_extra_information")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(EntityTranslation::Table)
                        .add_column(
                            ColumnDef::new(EntityTranslation::ShowExtraInformation).json_binary(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_column(table_name, "podcast_extra_information")
            .await?
        {
            manager
                .alter_table(
                    Table::alter()
                        .table(EntityTranslation::Table)
                        .add_column(
                            ColumnDef::new(EntityTranslation::PodcastExtraInformation)
                                .json_binary(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        let base_index = "entity_translation__language_metadata_id_variant_idx";
        if manager.has_index(table_name, base_index).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(base_index)
                        .table(EntityTranslation::Table)
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_index(table_name, base_index).await? {
            manager
                .create_index(
                    Index::create()
                        .name(base_index)
                        .unique()
                        .table(EntityTranslation::Table)
                        .col(EntityTranslation::Language)
                        .col(EntityTranslation::MetadataId)
                        .col(EntityTranslation::Variant)
                        .and_where(Expr::col(EntityTranslation::MetadataId).is_not_null())
                        .and_where(Expr::col(EntityTranslation::ShowExtraInformation).is_null())
                        .and_where(Expr::col(EntityTranslation::PodcastExtraInformation).is_null())
                        .to_owned(),
                )
                .await?;
        }

        let show_index = "entity_translation__language_metadata_id_variant_show_idx";
        let show_legacy_index = "entity_translation__language_metadata_id_variant_show_extra_idx";
        if manager.has_index(table_name, show_legacy_index).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(show_legacy_index)
                        .table(EntityTranslation::Table)
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_index(table_name, show_index).await? {
            manager
                .create_index(
                    Index::create()
                        .name(show_index)
                        .unique()
                        .table(EntityTranslation::Table)
                        .col(EntityTranslation::Language)
                        .col(EntityTranslation::MetadataId)
                        .col(EntityTranslation::Variant)
                        .col(EntityTranslation::ShowExtraInformation)
                        .and_where(Expr::col(EntityTranslation::MetadataId).is_not_null())
                        .and_where(Expr::col(EntityTranslation::ShowExtraInformation).is_not_null())
                        .to_owned(),
                )
                .await?;
        }

        let podcast_index = "entity_translation__language_metadata_id_variant_podcast_idx";
        let podcast_legacy_index =
            "entity_translation__language_metadata_id_variant_podcast_extra_idx";
        let podcast_legacy_truncated =
            "entity_translation__language_metadata_id_variant_podcast_extra_";
        if manager.has_index(table_name, podcast_legacy_index).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(podcast_legacy_index)
                        .table(EntityTranslation::Table)
                        .to_owned(),
                )
                .await?;
        }
        if manager.has_index(table_name, podcast_legacy_truncated).await? {
            manager
                .drop_index(
                    Index::drop()
                        .name(podcast_legacy_truncated)
                        .table(EntityTranslation::Table)
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_index(table_name, podcast_index).await? {
            manager
                .create_index(
                    Index::create()
                        .name(podcast_index)
                        .unique()
                        .table(EntityTranslation::Table)
                        .col(EntityTranslation::Language)
                        .col(EntityTranslation::MetadataId)
                        .col(EntityTranslation::Variant)
                        .col(EntityTranslation::PodcastExtraInformation)
                        .and_where(Expr::col(EntityTranslation::MetadataId).is_not_null())
                        .and_where(
                            Expr::col(EntityTranslation::PodcastExtraInformation).is_not_null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        let db = manager.get_connection();

        // DEV: This is to ensure new translations are picked up for existing users
        db.execute_unprepared(
            r#"
DELETE FROM application_cache where sanitized_key ILIKE 'UserEntityTranslations%';
DELETE FROM entity_translation;
"#,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
