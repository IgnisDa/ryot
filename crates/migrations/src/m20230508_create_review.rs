use enum_models::Visibility;
use indoc::indoc;
use sea_orm_migration::prelude::*;

use super::{
    m20230404_create_user::User, m20230410_create_metadata::Metadata,
    m20230411_create_metadata_group::MetadataGroup, m20230413_create_person::Person,
    m20230504_create_collection::Collection, m20230505_create_exercise::Exercise,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static METADATA_TO_REVIEW_FOREIGN_KEY: &str = "review_to_metadata_foreign_key";
pub static PERSON_TO_REVIEW_FOREIGN_KEY: &str = "review_to_person_foreign_key";
pub static METADATA_GROUP_TO_REVIEW_FOREIGN_KEY: &str = "review_to_metadata_group_foreign_key";
pub static COLLECTION_TO_REVIEW_FOREIGN_KEY: &str = "review_to_collection_foreign_key";
pub static EXERCISE_TO_REVIEW_FOREIGN_KEY: &str = "review_to_exercise_foreign_key";
pub static REVIEW_USER_ENTITY_INDEX: &str = "idx_review_user_entity";
pub static REVIEW_ENTITY_LOT_INDEX: &str = "idx_review_entity_lot";
pub static ENTITY_ID_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        COALESCE(
            "metadata_id",
            "person_id",
            "metadata_group_id",
            "collection_id",
            "exercise_id"
        )
    ) STORED
"# };
pub static ENTITY_LOT_SQL: &str = indoc! { r#"
    GENERATED ALWAYS AS (
        CASE
            WHEN "metadata_id" IS NOT NULL THEN 'metadata'
            WHEN "person_id" IS NOT NULL THEN 'person'
            WHEN "metadata_group_id" IS NOT NULL THEN 'metadata_group'
            WHEN "collection_id" IS NOT NULL THEN 'collection'
            WHEN "exercise_id" IS NOT NULL THEN 'exercise'
        END
    ) STORED
"# };

/// A review can be for either a creator or a media item.
#[derive(Iden)]
pub enum Review {
    Table,
    Id,
    PostedOn,
    Rating,
    Text,
    Visibility,
    UserId,
    EntityId,
    MetadataId,
    PersonId,
    MetadataGroupId,
    CollectionId,
    ExerciseId,
    IsSpoiler,
    Comments,
    ShowExtraInformation,
    PodcastExtraInformation,
    AnimeExtraInformation,
    MangaExtraInformation,
    EntityLot,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .col(ColumnDef::new(Review::Id).text().not_null().primary_key())
                    .col(
                        ColumnDef::new(Review::PostedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Review::Rating).decimal())
                    .col(ColumnDef::new(Review::Text).text())
                    .col(
                        ColumnDef::new(Review::IsSpoiler)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(Review::Visibility)
                            .text()
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .col(ColumnDef::new(Review::Comments).json_binary().not_null())
                    .col(ColumnDef::new(Review::ShowExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::PodcastExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::AnimeExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::MangaExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::CollectionId).text())
                    .col(ColumnDef::new(Review::MetadataGroupId).text())
                    .col(ColumnDef::new(Review::PersonId).text())
                    .col(ColumnDef::new(Review::MetadataId).text())
                    .col(ColumnDef::new(Review::UserId).text().not_null())
                    .col(ColumnDef::new(Review::ExerciseId).text())
                    .col(
                        ColumnDef::new(Review::EntityId)
                            .text()
                            .not_null()
                            .extra(ENTITY_ID_SQL),
                    )
                    .col(
                        ColumnDef::new(Review::EntityLot)
                            .text()
                            .not_null()
                            .extra(ENTITY_LOT_SQL),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_user_foreign_key")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(PERSON_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(COLLECTION_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_GROUP_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::MetadataGroupId)
                            .to(MetadataGroup::Table, MetadataGroup::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name(EXERCISE_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::ExerciseId)
                            .to(Exercise::Table, Exercise::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
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
        manager
            .create_index(
                Index::create()
                    .name(REVIEW_ENTITY_LOT_INDEX)
                    .table(Review::Table)
                    .col(Review::EntityLot)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
