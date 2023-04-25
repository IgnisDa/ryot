//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.2

use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "season")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub name: String,
    pub episode_count: Option<i32>,
    pub first_air_date: Option<DateTime<Utc>>,
    pub tmdb_id: String,
    pub number: i32,
    pub show_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::episode::Entity")]
    Episode,
    #[sea_orm(
        belongs_to = "super::show::Entity",
        from = "Column::ShowId",
        to = "super::show::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Show,
}

impl Related<super::episode::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Episode.def()
    }
}

impl Related<super::show::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Show.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
