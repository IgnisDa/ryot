//! `SeaORM` Entity. Generated by sea-orm-codegen 0.12.2

use async_trait::async_trait;
use chrono::NaiveDate;
use rust_decimal::Decimal;
use sea_orm::{entity::prelude::*, ActiveValue};
use serde::{Deserialize, Serialize};

use crate::{
    entities::{partial_metadata, prelude::PartialMetadata},
    migrator::{MetadataLot, MetadataSource},
    models::media::{MediaSpecifics, MetadataFreeCreators, MetadataImages, MetadataVideos},
};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, Default)]
#[sea_orm(table_name = "metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: DateTimeUtc,
    pub lot: MetadataLot,
    pub last_updated_on: DateTimeUtc,
    pub title: String,
    pub is_nsfw: bool,
    pub identifier: String,
    pub description: Option<String>,
    pub publish_year: Option<i32>,
    pub publish_date: Option<NaiveDate>,
    pub images: Option<MetadataImages>,
    pub videos: Option<MetadataVideos>,
    pub source: MetadataSource,
    pub specifics: MediaSpecifics,
    pub production_status: String,
    pub provider_rating: Option<Decimal>,
    pub last_processed_on_for_calendar: Option<DateTimeUtc>,
    pub free_creators: Option<MetadataFreeCreators>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::calendar_event::Entity")]
    CalendarEvent,
    #[sea_orm(has_many = "super::collection_to_entity::Entity")]
    CollectionToEntity,
    #[sea_orm(has_many = "super::metadata_to_genre::Entity")]
    MetadataToGenre,
    #[sea_orm(has_many = "super::metadata_to_partial_metadata::Entity")]
    MetadataToPartialMetadata,
    #[sea_orm(has_many = "super::metadata_to_person::Entity")]
    MetadataToPerson,
    #[sea_orm(has_many = "super::partial_metadata::Entity")]
    PartialMetadata,
    #[sea_orm(has_many = "super::review::Entity")]
    Review,
    #[sea_orm(has_many = "super::seen::Entity")]
    Seen,
    #[sea_orm(has_many = "super::user_to_entity::Entity")]
    UserToEntity,
}

impl Related<super::calendar_event::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CalendarEvent.def()
    }
}

impl Related<super::collection_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CollectionToEntity.def()
    }
}

impl Related<super::metadata_to_genre::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataToGenre.def()
    }
}

impl Related<super::metadata_to_partial_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataToPartialMetadata.def()
    }
}

impl Related<super::metadata_to_person::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataToPerson.def()
    }
}

impl Related<super::review::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Review.def()
    }
}

impl Related<super::seen::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Seen.def()
    }
}

impl Related<super::user_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToEntity.def()
    }
}

impl Related<super::genre::Entity> for Entity {
    fn to() -> RelationDef {
        super::metadata_to_genre::Relation::Genre.def()
    }
    fn via() -> Option<RelationDef> {
        Some(super::metadata_to_genre::Relation::Metadata.def().rev())
    }
}

impl Related<super::partial_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        super::metadata_to_partial_metadata::Relation::PartialMetadata.def()
    }
    fn via() -> Option<RelationDef> {
        Some(
            super::metadata_to_partial_metadata::Relation::Metadata
                .def()
                .rev(),
        )
    }
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {
    async fn after_save<C>(model: Model, db: &C, _insert: bool) -> Result<Model, DbErr>
    where
        C: ConnectionTrait,
    {
        if let Some(m) = PartialMetadata::find()
            .filter(partial_metadata::Column::Identifier.eq(model.identifier.clone()))
            .filter(partial_metadata::Column::Lot.eq(model.lot))
            .filter(partial_metadata::Column::Source.eq(model.source))
            .one(db)
            .await?
        {
            let mut m: partial_metadata::ActiveModel = m.into();
            m.metadata_id = ActiveValue::Set(Some(model.id));
            m.update(db).await?;
        }
        Ok(model)
    }
}
