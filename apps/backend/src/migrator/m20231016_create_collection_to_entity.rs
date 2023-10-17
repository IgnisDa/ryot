use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230413_create_person::Person,
    m20230507_create_collection::Collection, m20230622_create_exercise::Exercise,
    m20230901_create_metadata_group::MetadataGroup,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum CollectionToEntity {
    Table,
    Id,
    CollectionId,
    UpdatedOn,
    // the entities that can be added to a collection
    MetadataId,
    MetadataGroupId,
    PersonId,
    ExerciseId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(CollectionToEntity::Table)
                    .col(
                        ColumnDef::new(CollectionToEntity::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(CollectionToEntity::UpdatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(CollectionToEntity::CollectionId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk1")
                            .from(CollectionToEntity::Table, CollectionToEntity::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(CollectionToEntity::MetadataId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk2")
                            .from(CollectionToEntity::Table, CollectionToEntity::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(CollectionToEntity::PersonId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk3")
                            .from(CollectionToEntity::Table, CollectionToEntity::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(CollectionToEntity::MetadataGroupId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk4")
                            .from(
                                CollectionToEntity::Table,
                                CollectionToEntity::MetadataGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(CollectionToEntity::ExerciseId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("collection_to_entity-fk5")
                            .from(CollectionToEntity::Table, CollectionToEntity::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
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
