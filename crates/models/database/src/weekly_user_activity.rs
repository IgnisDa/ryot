//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

use async_graphql::SimpleObject;
use media_models::WeeklyUserActivityMetadataCount;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "weekly_user_activity")]
#[graphql(name = "WeeklyUserActivity")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub finished_week: Date,
    #[sea_orm(primary_key, auto_increment = false)]
    pub user_id: String,
    #[sea_orm(column_type = "Json")]
    pub metadata_counts: Vec<WeeklyUserActivityMetadataCount>,
    pub review_counts: Decimal,
    pub measurement_counts: Decimal,
    pub workout_counts: Decimal,
    pub total_counts: Decimal,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
