//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use crate::migrator::MediaItemMetadataImageLot;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "media_item_metadata_image")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub url: String,
    pub lot: MediaItemMetadataImageLot,
    pub metadata_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::media_item_metadata::Entity",
        from = "Column::MetadataId",
        to = "super::media_item_metadata::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    MediaItemMetadata,
}

impl Related<super::media_item_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MediaItemMetadata.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
