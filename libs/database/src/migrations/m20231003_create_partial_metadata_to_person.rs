// FIXME: Delete this migration in the next major release

use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{m20230413_create_person::Person, m20230901_create_partial_metadata::PartialMetadata};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumIter, DeriveActiveEnum, Deserialize, Serialize)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum PersonToPartialMetadataRelation {
    #[sea_orm(string_value = "WO")]
    WorkedOn,
}

#[derive(Iden)]
pub enum PersonToPartialMetadata {
    Table,
    PersonId,
    PartialMetadataId,
    Relation,
    /// the role the person has in this metadata
    Role,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(PersonToPartialMetadata::Table)
                    .col(
                        ColumnDef::new(PersonToPartialMetadata::PersonId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PersonToPartialMetadata::Relation)
                            .string_len(2)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PersonToPartialMetadata::Role)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(PersonToPartialMetadata::PartialMetadataId)
                            .integer()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .name("pk-person_to_partial-metadata")
                            .col(PersonToPartialMetadata::PersonId)
                            .col(PersonToPartialMetadata::PartialMetadataId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-person_to_pm-person_id-to-pm_id")
                            .from(
                                PersonToPartialMetadata::Table,
                                PersonToPartialMetadata::PersonId,
                            )
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk-person_to_pm-to-partial-metadata_id")
                            .from(
                                PersonToPartialMetadata::Table,
                                PersonToPartialMetadata::PartialMetadataId,
                            )
                            .to(PartialMetadata::Table, PartialMetadata::Id)
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
