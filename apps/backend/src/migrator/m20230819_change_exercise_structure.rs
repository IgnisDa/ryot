use itertools::Itertools;
use sea_orm::entity::prelude::*;
use sea_orm::{ActiveValue, DeriveEntityModel, EntityTrait, FromJsonQueryResult};
use sea_orm_migration::prelude::*;
use serde::{Deserialize, Serialize};

use crate::models::StoredUrl;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[derive(Debug, Clone, Serialize, Deserialize, FromJsonQueryResult, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExerciseAttributes {
    instructions: Vec<String>,
    #[serde(default)]
    internal_images: Vec<StoredUrl>,
    #[serde(default)]
    images: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "exercise")]
pub struct Model {
    #[sea_orm(primary_key)]
    id: i32,
    attributes: ExerciseAttributes,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        for exercise in Entity::find().all(db).await? {
            let images = exercise
                .attributes
                .images
                .iter()
                .map(|i| StoredUrl::Url(i.clone()))
                .collect_vec();
            let mut attributes = exercise.attributes.clone();
            attributes.internal_images = images;
            attributes.images = vec![];
            let mut ex: ActiveModel = exercise.into();
            ex.attributes = ActiveValue::Set(attributes);
            ex.update(db).await?;
        }
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
