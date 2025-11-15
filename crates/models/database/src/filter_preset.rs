use async_graphql::SimpleObject;
use async_trait::async_trait;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "filter_preset")]
#[graphql(name = "FilterPreset")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    #[graphql(skip)]
    pub user_id: String,
    #[graphql(skip)]
    pub context_type: String,
    #[graphql(skip)]
    pub created_at: DateTimeUtc,
    #[graphql(skip)]
    pub updated_at: DateTimeUtc,
    #[sea_orm(column_type = "JsonBinary")]
    pub filters: serde_json::Value,
    #[graphql(skip)]
    #[sea_orm(column_type = "JsonBinary")]
    pub context_metadata: Option<serde_json::Value>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

#[async_trait]
impl ActiveModelBehavior for ActiveModel {}
