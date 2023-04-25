//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use crate::migrator::MetadataLot;
use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: DateTime<Utc>,
    pub lot: MetadataLot,
    pub last_updated_on: DateTime<Utc>,
    pub title: String,
    pub description: Option<String>,
    pub publish_year: Option<i32>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_one = "super::book::Entity")]
    Book,
    #[sea_orm(has_one = "super::episode::Entity")]
    Episode,
    #[sea_orm(has_many = "super::metadata_image::Entity")]
    MetadataImage,
    #[sea_orm(has_one = "super::movie::Entity")]
    Movie,
    #[sea_orm(has_one = "super::season::Entity")]
    Season,
    #[sea_orm(has_many = "super::seen::Entity")]
    Seen,
    #[sea_orm(has_one = "super::show::Entity")]
    Show,
}

impl Related<super::book::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Book.def()
    }
}

impl Related<super::episode::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Episode.def()
    }
}

impl Related<super::metadata_image::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataImage.def()
    }
}

impl Related<super::movie::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Movie.def()
    }
}

impl Related<super::season::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Season.def()
    }
}

impl Related<super::seen::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Seen.def()
    }
}

impl Related<super::show::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Show.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        super::user_to_metadata::Relation::User.def()
    }
    fn via() -> Option<RelationDef> {
        Some(super::user_to_metadata::Relation::Metadata.def().rev())
    }
}

impl Related<super::creator::Entity> for Entity {
    fn to() -> RelationDef {
        super::metadata_to_creator::Relation::Creator.def()
    }
    fn via() -> Option<RelationDef> {
        Some(super::metadata_to_creator::Relation::Metadata.def().rev())
    }
}

impl ActiveModelBehavior for ActiveModel {}
