use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::Metadata, m20230413_create_person::Person,
    m20230507_create_collection::Collection, m20230901_create_metadata_group::MetadataGroup,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Iden)]
pub enum EntityToCollection {
    Table,
    Id,
    CollectionId,
    CreatedOn,
    // the entities that can be added to a collection
    MetadataId,
    MetadataGroupId,
    PersonId,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(EntityToCollection::Table)
                    .col(
                        ColumnDef::new(EntityToCollection::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(EntityToCollection::CreatedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(EntityToCollection::CollectionId)
                            .integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_collection-fk1")
                            .from(EntityToCollection::Table, EntityToCollection::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(EntityToCollection::MetadataId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_collection-fk2")
                            .from(EntityToCollection::Table, EntityToCollection::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(EntityToCollection::PersonId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_collection-fk3")
                            .from(EntityToCollection::Table, EntityToCollection::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(EntityToCollection::MetadataGroupId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("entity_to_collection-fk4")
                            .from(
                                EntityToCollection::Table,
                                EntityToCollection::MetadataGroupId,
                            )
                            .to(MetadataGroup::Table, MetadataGroup::Id)
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
