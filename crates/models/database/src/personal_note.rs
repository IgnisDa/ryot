use async_graphql::SimpleObject;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "personal_note")]
#[graphql(name = "PersonalNote")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    #[graphql(skip)]
    pub user_id: String,
    #[sea_orm(primary_key, auto_increment = false)]
    pub metadata_id: String,
    pub text: String,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::UserId",
        to = "super::user::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    User,
    #[sea_orm(
        belongs_to = "super::metadata::Entity",
        from = "Column::MetadataId",
        to = "super::metadata::Column::Id",
        on_delete = "Cascade",
        on_update = "Cascade"
    )]
    Metadata,
}

impl ActiveModelBehavior for ActiveModel {}
