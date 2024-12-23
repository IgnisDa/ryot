//! `SeaORM` Entity, @generated by sea-orm-codegen 1.0.1

use common_models::ApplicationCacheKey;
use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq)]
#[sea_orm(table_name = "application_cache")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: Uuid,
    pub version: String,
    pub created_at: DateTimeUtc,
    #[sea_orm(column_type = "Json")]
    pub key: ApplicationCacheKey,
    #[sea_orm(column_type = "Json")]
    pub value: serde_json::Value,
    pub expires_at: Option<DateTimeUtc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
