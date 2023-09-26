use sea_orm_migration::prelude::*;

use super::Metadata;

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_TO_PERSON_PRIMARY_KEY: &str = "pk-media-item_person";

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
}

#[derive(Iden)]
pub enum MetadataToPerson {
    Table,
    MetadataId,
    PersonId,
    Role,
    // The order in which the person will be displayed
    Index,
}

// TODO: Model to associate person to partial_metadata (for media suggestions).

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
                    .col(ColumnDef::new(Person::Identifier).string().not_null())
                    .col(ColumnDef::new(Person::Source).string_len(2).not_null())
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
                    .col(
                        ColumnDef::new(Person::Name)
                            .string()
                            .unique_key()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Person::Images).json())
                    .col(ColumnDef::new(Person::Description).text())
                    .col(ColumnDef::new(Person::Gender).string())
                    .col(ColumnDef::new(Person::BirthDate).date())
                    .col(ColumnDef::new(Person::DeathDate).date())
                    .col(ColumnDef::new(Person::Place).string())
                    .col(ColumnDef::new(Person::Website).string())
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .unique()
                    .name("person-identifier-source__unique_index")
                    .table(Person::Table)
                    .col(Person::Identifier)
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
                    .col(ColumnDef::new(MetadataToPerson::Index).integer().not_null())
                    .primary_key(
                        Index::create()
                            .name(METADATA_TO_PERSON_PRIMARY_KEY)
                            .col(MetadataToPerson::MetadataId)
                            .col(MetadataToPerson::PersonId)
                            .col(MetadataToPerson::Role),
                    )
                    .col(ColumnDef::new(MetadataToPerson::Role).string().not_null())
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
