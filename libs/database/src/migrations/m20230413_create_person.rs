use sea_orm_migration::prelude::*;

use super::m20230410_create_metadata::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_TO_PERSON_PRIMARY_KEY: &str = "pk-media-item_person";
pub static PERSON_IDENTIFIER_UNIQUE_KEY: &str = "person-identifier-source__unique_index";

#[derive(Iden)]
pub enum Person {
    Table,
    Id,
    Identifier,
    Source,
    CreatedOn,
    LastUpdatedOn,
    Name,
    Description,
    Gender,
    BirthDate,
    DeathDate,
    // The place of origin
    Place,
    Website,
    Images,
    IsPartial,
    SourceSpecifics,
}

#[derive(Iden)]
pub enum MetadataToPerson {
    Table,
    MetadataId,
    PersonId,
    Role,
    // The order in which the person will be displayed
    Index,
    Character,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Person::Table)
                    .col(
                        ColumnDef::new(Person::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
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
                    .col(ColumnDef::new(Person::Images).json_binary())
                    .col(ColumnDef::new(Person::IsPartial).boolean())
                    .col(ColumnDef::new(Person::SourceSpecifics).json_binary())
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
                    .col(
                        ColumnDef::new(MetadataToPerson::MetadataId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(MetadataToPerson::PersonId)
                            .integer()
                            .not_null(),
                    )
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
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
