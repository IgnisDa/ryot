use async_graphql::Enum;
use schematic::ConfigEnum;
use sea_orm::{DeriveActiveEnum, EnumIter};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use super::{
    m20230410_create_metadata::Metadata, m20230413_create_person::Person,
    m20230417_create_user::User, m20230501_create_metadata_group::MetadataGroup,
    m20230504_create_collection::Collection,
};

#[derive(DeriveMigrationName)]
pub struct Migration;

pub static PERSON_TO_REVIEW_FOREIGN_KEY: &str = "review_to_person_foreign_key";
pub static METADATA_GROUP_TO_REVIEW_FOREIGN_KEY: &str = "review_to_metadata_group_foreign_key";
pub static COLLECTION_TO_REVIEW_FOREIGN_KEY: &str = "review_to_collection_foreign_key";

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumIter,
    DeriveActiveEnum,
    Deserialize,
    Serialize,
    Enum,
    Default,
    ConfigEnum,
)]
#[sea_orm(rs_type = "String", db_type = "String(None)")]
pub enum Visibility {
    #[default]
    #[sea_orm(string_value = "PU")]
    Public,
    #[sea_orm(string_value = "PR")]
    Private,
}

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
    MetadataId,
    PersonId,
    MetadataGroupId,
    CollectionId,
    Spoiler,
    Comments,
    ShowExtraInformation,
    PodcastExtraInformation,
    AnimeExtraInformation,
    MangaExtraInformation,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Review::Table)
                    .col(
                        ColumnDef::new(Review::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Review::PostedOn)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(Review::Rating).decimal())
                    .col(ColumnDef::new(Review::Text).string())
                    .col(
                        ColumnDef::new(Review::Spoiler)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Review::Comments).json_binary().not_null())
                    .col(ColumnDef::new(Review::ShowExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::PodcastExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::AnimeExtraInformation).json_binary())
                    .col(ColumnDef::new(Review::MangaExtraInformation).json_binary())
                    .col(
                        ColumnDef::new(Review::Visibility)
                            .string_len(2)
                            .not_null()
                            .default(Visibility::Private),
                    )
                    .col(ColumnDef::new(Review::UserId).integer().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_user_foreign_key")
                            .from(Review::Table, Review::UserId)
                            .to(User::Table, User::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::MetadataId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name("review_to_metadata_foreign_key")
                            .from(Review::Table, Review::MetadataId)
                            .to(Metadata::Table, Metadata::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::PersonId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name(PERSON_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::PersonId)
                            .to(Person::Table, Person::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::CollectionId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name(COLLECTION_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::CollectionId)
                            .to(Collection::Table, Collection::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .col(ColumnDef::new(Review::MetadataGroupId).integer())
                    .foreign_key(
                        ForeignKey::create()
                            .name(METADATA_GROUP_TO_REVIEW_FOREIGN_KEY)
                            .from(Review::Table, Review::MetadataGroupId)
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
