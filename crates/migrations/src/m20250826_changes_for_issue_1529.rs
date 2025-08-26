use sea_orm_migration::prelude::*;

use super::{
    m20230410_create_metadata::{
        METADATA_DESCRIPTION_INDEX, METADATA_PROVIDER_RATING_INDEX, Metadata,
    },
    m20230508_create_review::{REVIEW_ENTITY_LOT_INDEX, REVIEW_USER_ENTITY_INDEX, Review},
    m20230510_create_seen::{SEEN_FINISHED_ON_INDEX, SEEN_USER_METADATA_INDEX, Seen},
    m20231017_create_user_to_entity::{
        ENTITY_ID_SQL, ENTITY_LOT_SQL, USER_TO_ENTITY_ENTITY_LOT_INDEX,
        USER_TO_ENTITY_USER_ENTITY_LOT_INDEX, UserToEntity,
    },
};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();

        db.execute_unprepared(
            r#"
CREATE EXTENSION IF NOT EXISTS "btree_gin";
        "#,
        )
        .await?;

        if !manager.has_column("user_to_entity", "entity_id").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToEntity::Table)
                        .add_column(
                            ColumnDef::new(UserToEntity::EntityId)
                                .text()
                                .not_null()
                                .extra(ENTITY_ID_SQL),
                        )
                        .to_owned(),
                )
                .await?;
        }
        if !manager.has_column("user_to_entity", "entity_lot").await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(UserToEntity::Table)
                        .add_column(
                            ColumnDef::new(UserToEntity::EntityLot)
                                .text()
                                .not_null()
                                .extra(ENTITY_LOT_SQL),
                        )
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("review", REVIEW_USER_ENTITY_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(REVIEW_USER_ENTITY_INDEX)
                        .table(Review::Table)
                        .col(Review::UserId)
                        .col(Review::EntityId)
                        .col(Review::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("user_to_entity", USER_TO_ENTITY_ENTITY_LOT_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(USER_TO_ENTITY_ENTITY_LOT_INDEX)
                        .table(UserToEntity::Table)
                        .col(UserToEntity::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_index("review", REVIEW_ENTITY_LOT_INDEX).await? {
            manager
                .create_index(
                    Index::create()
                        .name(REVIEW_ENTITY_LOT_INDEX)
                        .table(Review::Table)
                        .col(Review::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("user_to_entity", USER_TO_ENTITY_USER_ENTITY_LOT_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(USER_TO_ENTITY_USER_ENTITY_LOT_INDEX)
                        .table(UserToEntity::Table)
                        .col(UserToEntity::UserId)
                        .col(UserToEntity::EntityLot)
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_index("seen", SEEN_USER_METADATA_INDEX).await? {
            manager
                .create_index(
                    Index::create()
                        .name(SEEN_USER_METADATA_INDEX)
                        .table(Seen::Table)
                        .col(Seen::UserId)
                        .col(Seen::MetadataId)
                        .to_owned(),
                )
                .await?;
        }

        if !manager.has_index("seen", SEEN_FINISHED_ON_INDEX).await? {
            manager
                .create_index(
                    Index::create()
                        .name(SEEN_FINISHED_ON_INDEX)
                        .table(Seen::Table)
                        .col(Seen::FinishedOn)
                        .and_where(Expr::col((Seen::Table, Seen::FinishedOn)).is_not_null())
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("metadata", METADATA_DESCRIPTION_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(METADATA_DESCRIPTION_INDEX)
                        .table(Metadata::Table)
                        .col(Metadata::Description)
                        .index_type(IndexType::FullText)
                        .to_owned(),
                )
                .await?;
        }

        if !manager
            .has_index("metadata", METADATA_PROVIDER_RATING_INDEX)
            .await?
        {
            manager
                .create_index(
                    Index::create()
                        .name(METADATA_PROVIDER_RATING_INDEX)
                        .table(Metadata::Table)
                        .col(Metadata::ProviderRating)
                        .and_where(
                            Expr::col((Metadata::Table, Metadata::ProviderRating)).is_not_null(),
                        )
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
