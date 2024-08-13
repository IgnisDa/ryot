//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use async_trait::async_trait;
use enums::Visibility;
use media_models::{
    ImportOrExportItemReviewComment, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use nanoid::nanoid;
use rust_decimal::Decimal;
use sea_orm::{entity::prelude::*, ActiveValue};
use serde::{Deserialize, Serialize};

use crate::functions::associate_user_with_entity;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "review")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub posted_on: DateTimeUtc,
    pub rating: Option<Decimal>,
    pub text: Option<String>,
    pub visibility: Visibility,
    pub is_spoiler: bool,
    pub user_id: String,
    pub metadata_id: Option<String>,
    pub person_id: Option<String>,
    pub metadata_group_id: Option<String>,
    pub collection_id: Option<String>,
    pub show_extra_information: Option<SeenShowExtraInformation>,
    pub podcast_extra_information: Option<SeenPodcastExtraInformation>,
    pub anime_extra_information: Option<SeenAnimeExtraInformation>,
    pub manga_extra_information: Option<SeenMangaExtraInformation>,
    #[sea_orm(column_type = "Json")]
    pub comments: Vec<ImportOrExportItemReviewComment>,
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
            associate_user_with_entity(
                &model.user_id,
                model.metadata_id.clone(),
                model.person_id.clone(),
                None,
                model.metadata_group_id.clone(),
                db,
            )
            .await
            .ok();
        }
        Ok(model)
    }
}
