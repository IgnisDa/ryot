//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

use std::sync::Arc;

use async_graphql::{InputObject, Result, SimpleObject};
use async_trait::async_trait;
use enums::{
    ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic, ExerciseMuscle,
    ExerciseSource,
};
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    file_storage::FileStorageService, models::fitness::ExerciseAttributes,
    traits::GraphqlRepresentation,
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
    #[graphql(skip_input)]
    pub source: ExerciseSource,
    #[sea_orm(column_type = "Json")]
    pub muscles: Vec<ExerciseMuscle>,
    pub attributes: ExerciseAttributes,
    #[graphql(skip_input)]
    pub created_by_user_id: Option<String>,
}

#[async_trait]
impl GraphqlRepresentation for Model {
    async fn graphql_representation(
        self,
        file_storage_service: &Arc<FileStorageService>,
    ) -> Result<Self> {
        let mut converted_exercise = self.clone();
        let mut images = vec![];
        for image in self.attributes.internal_images.iter() {
            images.push(file_storage_service.get_stored_asset(image.clone()).await);
        }
        converted_exercise.attributes.images = images;
        Ok(converted_exercise)
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::collection_to_entity::Entity")]
    CollectionToEntity,
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::CreatedByUserId",
        to = "super::user::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    User,
    #[sea_orm(has_many = "super::user_to_entity::Entity")]
    UserToEntity,
}

impl Related<super::collection_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::CollectionToEntity.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::User.def()
    }
}

impl Related<super::user_to_entity::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToEntity.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
