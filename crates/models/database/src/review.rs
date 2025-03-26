//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use async_trait::async_trait;
use enum_models::{EntityLot, Visibility};
use media_models::{
    ImportOrExportItemReviewComment, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraOptionalInformation, SeenShowExtraOptionalInformation,
};
use nanoid::nanoid;
use rust_decimal::Decimal;
use sea_orm::{ActiveValue, entity::prelude::*};
use serde::{Deserialize, Serialize};

use super::functions::associate_user_with_entity;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "review")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_id: String,
    pub is_spoiler: bool,
    pub entity_id: String,
    pub text: Option<String>,
    pub entity_lot: EntityLot,
    pub posted_on: DateTimeUtc,
    pub visibility: Visibility,
    pub rating: Option<Decimal>,
    pub person_id: Option<String>,
    pub exercise_id: Option<String>,
    pub metadata_id: Option<String>,
    pub collection_id: Option<String>,
    pub metadata_group_id: Option<String>,
    #[sea_orm(column_type = "Json")]
    pub comments: Vec<ImportOrExportItemReviewComment>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
    pub show_extra_information: Option<SeenShowExtraOptionalInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraOptionalInformation>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::collection::Entity",
        from = "Column::CollectionId",
        to = "super::collection::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Collection,
    #[sea_orm(
        belongs_to = "super::exercise::Entity",
        from = "Column::ExerciseId",
        to = "super::exercise::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Exercise,
    #[sea_orm(
        belongs_to = "super::metadata::Entity",
        from = "Column::MetadataId",
        to = "super::metadata::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Metadata,
    #[sea_orm(
        belongs_to = "super::metadata_group::Entity",
        from = "Column::MetadataGroupId",
        to = "super::metadata_group::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    MetadataGroup,
    #[sea_orm(
        belongs_to = "super::person::Entity",
        from = "Column::PersonId",
        to = "super::person::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Person,
    #[sea_orm(has_many = "super::seen::Entity")]
    Seen,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
}

impl Related<super::collection::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Collection.def()
    }
}

impl Related<super::exercise::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Exercise.def()
    }
}

impl Related<super::metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Metadata.def()
    }
}

impl Related<super::metadata_group::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataGroup.def()
    }
}

impl Related<super::person::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Person.def()
    }
}

impl Related<super::seen::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Seen.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn before_save<C>(mut self, _db: &C, insert: bool) -> Result<Self, DbErr>
    where
        C: ConnectionTrait,
    {
        if insert {
            self.id = ActiveValue::Set(format!("rev_{}", nanoid!(12)));
        }
        Ok(self)
    }

    async fn after_save<C>(model: Model, db: &C, insert: bool) -> Result<Model, DbErr>
    where
        C: ConnectionTrait,
    {
        if insert {
            associate_user_with_entity(db, &model.user_id, &model.entity_id, model.entity_lot)
                .await
                .ok();
        }
        Ok(model)
    }
}
