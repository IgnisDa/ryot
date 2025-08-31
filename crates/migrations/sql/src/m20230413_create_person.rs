use migrations_utils::create_trigram_index_if_required;
use sea_orm_migration::prelude::*;

use super::{m20230410_create_metadata::Metadata, m20230411_create_metadata_group::MetadataGroup};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_TO_PERSON_PRIMARY_KEY: &str = "pk-media-item_person";
pub static PERSON_IDENTIFIER_UNIQUE_KEY: &str = "person-identifier-source__unique_index";
pub static PERSON_ASSOCIATED_METADATA_COUNT_GENERATED_SQL: &str = r#"GENERATED ALWAYS AS (COALESCE(JSONB_ARRAY_LENGTH("state_changes"->'metadata_associated'), 0)) STORED"#;
pub static PERSON_ASSOCIATED_METADATA_GROUPS_COUNT_GENERATED_SQL: &str = r#"GENERATED ALWAYS AS (COALESCE(JSONB_ARRAY_LENGTH("state_changes"->'metadata_groups_associated'), 0)) STORED"#;
pub static PERSON_ASSOCIATED_ENTITY_COUNT_GENERATED_SQL: &str = r#"GENERATED ALWAYS AS (COALESCE(JSONB_ARRAY_LENGTH("state_changes"->'metadata_associated'), 0) + COALESCE(JSONB_ARRAY_LENGTH("state_changes"->'metadata_groups_associated'), 0)) STORED"#;
pub static PERSON_NAME_TRIGRAM_INDEX: &str = "person_name_trigram_idx";
pub static PERSON_DESCRIPTION_TRIGRAM_INDEX: &str = "person_description_trigram_idx";

#[derive(Iden)]
pub enum Person {
    Id,
    Name,
    Table,
    Place,
    Source,
    Gender,
    Assets,
    Website,
    BirthDate,
    CreatedOn,
    DeathDate,
    IsPartial,
    SourceUrl,
    Identifier,
    Description,
    StateChanges,
    LastUpdatedOn,
    AlternateNames,
    SourceSpecifics,
    AssociatedEntityCount,
    AssociatedMetadataCount,
    AssociatedMetadataGroupsCount,
}

#[derive(Iden)]
pub enum MetadataToPerson {
    Role,
    Table,
    // The order in which the person will be displayed
    Index,
    PersonId,
    Character,
    MetadataId,
}

#[derive(Iden)]
pub enum MetadataGroupToPerson {
    Role,
    Table,
    Index,
    PersonId,
    MetadataGroupId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Person::Table)
                    .col(ColumnDef::new(Person::Id).text().not_null().primary_key())
                    .col(ColumnDef::new(Person::Identifier).text().not_null())
                    .col(ColumnDef::new(Person::Source).text().not_null())
                    .col(
                        ColumnDef::new(Person::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Person::LastUpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Person::Name).text().not_null())
                    .col(ColumnDef::new(Person::Description).text())
                    .col(ColumnDef::new(Person::Gender).text())
                    .col(ColumnDef::new(Person::BirthDate).date())
                    .col(ColumnDef::new(Person::DeathDate).date())
                    .col(ColumnDef::new(Person::Place).text())
                    .col(ColumnDef::new(Person::Website).text())
                    .col(ColumnDef::new(Person::IsPartial).boolean())
                    .col(ColumnDef::new(Person::SourceSpecifics).json_binary())
                    .col(ColumnDef::new(Person::StateChanges).json_binary())
                    .col(ColumnDef::new(Person::SourceUrl).text())
                    .col(ColumnDef::new(Person::AlternateNames).array(ColumnType::Text))
                    .col(
                        ColumnDef::new(Person::AssociatedMetadataCount)
                            .integer()
                            .not_null()
                            .extra(PERSON_ASSOCIATED_METADATA_COUNT_GENERATED_SQL),
                    )
                    .col(
                        ColumnDef::new(Person::AssociatedMetadataGroupsCount)
                            .integer()
                            .not_null()
                            .extra(PERSON_ASSOCIATED_METADATA_GROUPS_COUNT_GENERATED_SQL),
                    )
                    .col(
                        ColumnDef::new(Person::AssociatedEntityCount)
                            .integer()
                            .not_null()
                            .extra(PERSON_ASSOCIATED_ENTITY_COUNT_GENERATED_SQL),
                    )
                    .col(ColumnDef::new(Person::Assets).json_binary().not_null())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name(PERSON_IDENTIFIER_UNIQUE_KEY)
                    .table(Person::Table)
                    .col(Person::Identifier)
                    .col(Person::Source)
                    .col(Person::SourceSpecifics)
                    .nulls_not_distinct()
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataToPerson::Table)
                    .col(ColumnDef::new(MetadataToPerson::Index).integer())
                    .primary_key(
                        Index::create()
                            .name(METADATA_TO_PERSON_PRIMARY_KEY)
                            .col(MetadataToPerson::MetadataId)
                            .col(MetadataToPerson::PersonId)
                            .col(MetadataToPerson::Role),
                    )
                    .col(ColumnDef::new(MetadataToPerson::Role).text().not_null())
                    .col(ColumnDef::new(MetadataToPerson::Character).text())
                    .col(ColumnDef::new(MetadataToPerson::PersonId).text().not_null())
                    .col(
                        ColumnDef::new(MetadataToPerson::MetadataId)
                            .text()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-media-item_media-person_id")
                            .from(MetadataToPerson::Table, MetadataToPerson::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-person-item_media-person_id")
                            .from(MetadataToPerson::Table, MetadataToPerson::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_table(
                Table::create()
                    .table(MetadataGroupToPerson::Table)
                    .col(
                        ColumnDef::new(MetadataGroupToPerson::Role)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataGroupToPerson::PersonId)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataGroupToPerson::MetadataGroupId)
                            .text()
                            .not_null(),
                    )
                    .col(ColumnDef::new(MetadataGroupToPerson::Index).integer())
                    .primary_key(
                        Index::create()
                            .name("metadata_group_to_person-primary-key")
                            .col(MetadataGroupToPerson::MetadataGroupId)
                            .col(MetadataGroupToPerson::PersonId)
                            .col(MetadataGroupToPerson::Role),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_group-item_person-person_id")
                            .from(
                                MetadataGroupToPerson::Table,
                                MetadataGroupToPerson::PersonId,
                            )
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-metadata_group-item_person-metadata_group_id")
                            .from(
                                MetadataGroupToPerson::Table,
                                MetadataGroupToPerson::MetadataGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        create_trigram_index_if_required(manager, "person", "name", PERSON_NAME_TRIGRAM_INDEX).await?;
        create_trigram_index_if_required(
            manager,
            "person",
            "description",
            PERSON_DESCRIPTION_TRIGRAM_INDEX,
        )
        .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
