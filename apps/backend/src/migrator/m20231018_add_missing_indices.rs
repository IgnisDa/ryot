use sea_orm::entity::prelude::*;
use sea_orm_migration::prelude::*;

use super::m20231016_create_collection_to_entity::{
    CollectionToEntity, UNIQUE_INDEX_1, UNIQUE_INDEX_2, UNIQUE_INDEX_3, UNIQUE_INDEX_4,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager
            .has_index("collection_to_entity", UNIQUE_INDEX_1)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(UNIQUE_INDEX_1)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(CollectionToEntity::MetadataId)
                        .to_owned(),
                )
                .await?;
        }
        if !manager
            .has_index("collection_to_entity", UNIQUE_INDEX_2)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(UNIQUE_INDEX_2)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(CollectionToEntity::PersonId)
                        .to_owned(),
                )
                .await?;
        }
        if !manager
            .has_index("collection_to_entity", UNIQUE_INDEX_3)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(UNIQUE_INDEX_3)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(CollectionToEntity::MetadataGroupId)
                        .to_owned(),
                )
                .await?;
        }
        if !manager
            .has_index("collection_to_entity", UNIQUE_INDEX_4)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .unique()
                        .name(UNIQUE_INDEX_4)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(CollectionToEntity::ExerciseId)
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
