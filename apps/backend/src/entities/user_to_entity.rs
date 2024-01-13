//! `SeaORM` Entity. Generated by sea-orm-codegen 0.12.3

use async_graphql::SimpleObject;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::models::{
    fitness::UserToExerciseExtraInformation,
    media::{UserMediaOwnership, UserMediaReminder},
};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "user_to_entity")]
#[graphql(name = "UserToEntity")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub last_updated_on: DateTimeUtc,
    pub user_id: i32,
    pub metadata_id: Option<i32>,
    pub exercise_id: Option<String>,
    pub metadata_monitored: Option<bool>,
    pub metadata_units_consumed: Option<i32>,
    pub metadata_reminder: Option<UserMediaReminder>,
    pub metadata_ownership: Option<UserMediaOwnership>,
    pub exercise_extra_information: Option<UserToExerciseExtraInformation>,
    pub exercise_num_times_interacted: Option<i32>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
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
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
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

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
