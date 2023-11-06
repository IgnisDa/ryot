//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

use std::sync::Arc;

use async_graphql::{InputObject, Result, SimpleObject};
use async_trait::async_trait;
use database::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    ExerciseSource,
};
use sea_orm::{entity::prelude::*, FromQueryResult};
use serde::{Deserialize, Serialize};

use crate::{
    file_storage::FileStorageService, models::fitness::ExerciseAttributes,
    traits::GraphqlRepresentation, utils::get_stored_asset,
};

#[derive(
    Clone,
    Debug,
    PartialEq,
    DeriveEntityModel,
    Eq,
    Serialize,
    Deserialize,
    SimpleObject,
    InputObject,
)]
#[sea_orm(table_name = "exercise")]
#[graphql(name = "Exercise", input_name = "ExerciseInput")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[graphql(skip)]
    #[sea_orm(unique)]
    pub identifier: Option<String>,
    pub lot: ExerciseLot,
    pub level: ExerciseLevel,
    pub force: Option<ExerciseForce>,
    pub mechanic: Option<ExerciseMechanic>,
    pub equipment: Option<ExerciseEquipment>,
    pub source: ExerciseSource,
    #[sea_orm(column_type = "Json")]
    pub muscles: Vec<ExerciseMuscle>,
    pub attributes: ExerciseAttributes,
}

#[async_trait]
impl GraphqlRepresentation for Model {
    async fn graphql_repr(self, file_storage_service: &Arc<FileStorageService>) -> Result<Self> {
        let mut converted_exercise = self.clone();
        let mut images = vec![];
        for image in self.attributes.internal_images.iter() {
            images.push(get_stored_asset(image.clone(), file_storage_service).await);
        }
        converted_exercise.attributes.images = images;
        Ok(converted_exercise)
    }
}

#[derive(Clone, Debug, Deserialize, SimpleObject, FromQueryResult)]
pub struct ExerciseListItem {
    pub lot: ExerciseLot,
    pub id: String,
    #[graphql(skip)]
    pub attributes: ExerciseAttributes,
    pub num_times_interacted: Option<i32>,
    pub muscle: Option<ExerciseMuscle>,
    pub image: Option<String>,
    #[graphql(skip)]
    pub muscles: Vec<ExerciseMuscle>,
}

#[async_trait]
impl GraphqlRepresentation for ExerciseListItem {
    async fn graphql_repr(self, file_storage_service: &Arc<FileStorageService>) -> Result<Self> {
        let mut converted_exercise = self.clone();
        if let Some(img) = self.attributes.internal_images.first() {
            converted_exercise.image =
                Some(get_stored_asset(img.clone(), file_storage_service).await);
        }
        converted_exercise.muscle = self.muscles.first().cloned();
        Ok(converted_exercise)
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::collection_to_entity::Entity")]
    CollectionToEntity,
    #[sea_orm(has_many = "super::user_to_entity::Entity")]
    UserToEntity,
}

impl Related<super::collection_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CollectionToEntity.def()
    }
}

impl Related<super::user_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToEntity.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
