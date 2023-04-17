//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "open_library_key")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub key: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::book::Entity",
        from = "Column::Id",
        to = "super::book::Column::MetadataId",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Book,
}

impl Related<super::book::Entity> for Entity {
    fn to() -> RelationDef {
        super::book_open_library_key::Relation::Book.def()
    }
    fn via() -> Option<RelationDef> {
        Some(
            super::book_open_library_key::Relation::OpenLibraryKey
                .def()
                .rev(),
        )
    }
}

impl ActiveModelBehavior for ActiveModel {}
