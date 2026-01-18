use indoc::indoc;
use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230411_create_metadata_group::MetadataGroup,
    m20230413_create_person::Person,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static ENTITY_TRANSLATION_CONSTRAINT_SQL: &str = indoc! { r#"
    ALTER TABLE "entity_translation" DROP CONSTRAINT IF EXISTS "entity_translation__ensure_one_entity";
    ALTER TABLE "entity_translation"
    ADD CONSTRAINT "entity_translation__ensure_one_entity"
    CHECK (
        (CASE WHEN "person_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "metadata_id" IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN "metadata_group_id" IS NOT NULL THEN 1 ELSE 0 END)
        = 1
        );
"# };
pub static ENTITY_TRANSLATION_ENTITY_ID_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        COALESCE(
            "person_id",
            "metadata_id",
            "metadata_group_id"
        )
    ) STORED
"# };
pub static ENTITY_TRANSLATION_ENTITY_LOT_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        CASE
            WHEN "person_id" IS NOT NULL THEN 'person'
            WHEN "metadata_id" IS NOT NULL THEN 'metadata'
            WHEN "metadata_group_id" IS NOT NULL THEN 'metadata_group'
        END
    ) STORED
"# };

#[derive(Iden)]
pub enum EntityTranslation {
    Id,
    Table,
    Value,
    Variant,
    Language,
    PersonId,
    EntityId,
    CreatedOn,
    EntityLot,
    MetadataId,
    MetadataGroupId,
    ShowExtraInformation,
    PodcastExtraInformation,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        manager
            .create_table(
                Table::create()
                    .table(EntityTranslation::Table)
                    .col(
                        ColumnDef::new(EntityTranslation::Id)
                            .uuid()
                            .not_null()
                            .default(PgFunc::gen_random_uuid())
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(EntityTranslation::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(EntityTranslation::MetadataId).text())
                    .col(ColumnDef::new(EntityTranslation::MetadataGroupId).text())
                    .col(ColumnDef::new(EntityTranslation::PersonId).text())
                    .col(ColumnDef::new(EntityTranslation::Value).text())
                    .col(ColumnDef::new(EntityTranslation::Variant).text().not_null())
                    .col(
                        ColumnDef::new(EntityTranslation::Language)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(EntityTranslation::EntityLot)
                            .text()
                            .not_null()
                            .extra(ENTITY_TRANSLATION_ENTITY_LOT_SQL),
                    )
                    .col(
                        ColumnDef::new(EntityTranslation::EntityId)
                            .text()
                            .not_null()
                            .extra(ENTITY_TRANSLATION_ENTITY_ID_SQL),
                    )
                    .col(ColumnDef::new(EntityTranslation::ShowExtraInformation).json_binary())
                    .col(ColumnDef::new(EntityTranslation::PodcastExtraInformation).json_binary())
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_translation-fk1")
                            .from(EntityTranslation::Table, EntityTranslation::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_translation-fk2")
                            .from(EntityTranslation::Table, EntityTranslation::MetadataGroupId)
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_translation-fk3")
                            .from(EntityTranslation::Table, EntityTranslation::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        db.execute_unprepared(ENTITY_TRANSLATION_CONSTRAINT_SQL)
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("entity_translation__language_metadata_id_variant_idx")
                    .unique()
                    .table(EntityTranslation::Table)
                    .col(EntityTranslation::Language)
                    .col(EntityTranslation::MetadataId)
                    .col(EntityTranslation::Variant)
                    .col(EntityTranslation::ShowExtraInformation)
                    .col(EntityTranslation::PodcastExtraInformation)
                    .and_where(Expr::col(EntityTranslation::MetadataId).is_not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("entity_translation__language_metadata_group_id_variant_idx")
                    .unique()
                    .table(EntityTranslation::Table)
                    .col(EntityTranslation::Language)
                    .col(EntityTranslation::MetadataGroupId)
                    .col(EntityTranslation::Variant)
                    .and_where(Expr::col(EntityTranslation::MetadataGroupId).is_not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("entity_translation__language_person_id_variant_idx")
                    .unique()
                    .table(EntityTranslation::Table)
                    .col(EntityTranslation::Language)
                    .col(EntityTranslation::PersonId)
                    .col(EntityTranslation::Variant)
                    .and_where(Expr::col(EntityTranslation::PersonId).is_not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("entity_translation__language_entity_id_lot_idx")
                    .table(EntityTranslation::Table)
                    .col(EntityTranslation::Language)
                    .col(EntityTranslation::EntityId)
                    .col(EntityTranslation::EntityLot)
                    .to_owned(),
            )
            .await?;
        create_trigram_index_if_required(
            manager,
            "entity_translation",
            "value",
            "entity_translation_value_trigram_idx",
        )
        .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
