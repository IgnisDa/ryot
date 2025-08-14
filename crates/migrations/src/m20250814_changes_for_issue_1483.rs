use sea_orm_migration::prelude::*;

use super::{
    m20230404_create_user::{IS_DISABLED_INDEX, User},
    m20231016_create_collection_to_entity::{
        COMPOSITE_INDEX, CollectionToEntity, ENTITY_ID_INDEX, ENTITY_LOT_INDEX,
    },
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        if !manager.has_index("user", IS_DISABLED_INDEX).await? {
            manager
                .create_index(
                    Index::create()
                        .name(IS_DISABLED_INDEX)
                        .table(User::Table)
                        .col(User::IsDisabled)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("collection_to_entity", ENTITY_ID_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(ENTITY_ID_INDEX)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::EntityId)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("collection_to_entity", ENTITY_LOT_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(ENTITY_LOT_INDEX)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("collection_to_entity", COMPOSITE_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(COMPOSITE_INDEX)
                        .table(CollectionToEntity::Table)
                        .col(CollectionToEntity::CollectionId)
                        .col(CollectionToEntity::EntityId)
                        .col(CollectionToEntity::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        let db = manager.get_connection();
        db.execute_unprepared("DROP VIEW IF EXISTS monitored_entity")
            .await?;

        db.execute_unprepared(
            "UPDATE notification_platform
             SET configured_events = array_append(configured_events, 'metadata_moved_from_completed_to_watchlist_collection')
             WHERE 'metadata_moved_from_completed_to_watchlist_collection' != ALL(configured_events)"
        ).await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
