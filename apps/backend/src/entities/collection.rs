//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

use async_graphql::SimpleObject;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::miscellaneous::CollectionExtraInformation;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "collection")]
#[graphql(name = "Collection")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub created_on: DateTimeUtc,
    pub last_updated_on: DateTimeUtc,
    pub name: String,
    pub description: Option<String>,
    pub user_id: i32,
    #[sea_orm(column_type = "Json")]
    pub information_template: Option<Vec<CollectionExtraInformation>>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::collection_to_entity::Entity")]
    CollectionToEntity,
    #[sea_orm(has_many = "super::review::Entity")]
    Review,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
    #[sea_orm(has_many = "super::user_to_collection::Entity")]
    UserToCollection,
}

impl Related<super::collection_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CollectionToEntity.def()
    }
}

impl Related<super::review::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Review.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl Related<super::user_to_collection::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToCollection.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
