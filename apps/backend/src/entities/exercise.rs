//! `SeaORM` Entity. Generated by sea-orm-codegen 0.11.3

use std::sync::Arc;

use async_graphql::SimpleObject;
use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

use crate::{
    file_storage::FileStorageService,
    migrator::{
        ExerciseEquipment, ExerciseForce, ExerciseLevel, ExerciseLot, ExerciseMechanic,
        ExerciseMuscle,
    },
    models::fitness::{ExerciseAttributes, ExerciseMuscles},
    utils::get_stored_image,
};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize, SimpleObject)]
#[sea_orm(table_name = "exercise")]
#[graphql(name = "Exercise")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(unique)]
    pub name: String,
    #[sea_orm(unique)]
    pub identifier: String,
    pub lot: ExerciseLot,
    pub level: ExerciseLevel,
    pub force: Option<ExerciseForce>,
    pub mechanic: Option<ExerciseMechanic>,
    pub equipment: Option<ExerciseEquipment>,
    pub attributes: ExerciseAttributes,
    // #[graphql(skip)]
    // pub muscles: ExerciseMuscles,
    pub muscles: Vec<ExerciseMuscle>,
}

impl Model {
    pub async fn graphql_repr(self, file_storage_service: &Arc<FileStorageService>) -> Self {
        let mut converted_exercise = self.clone();
        let mut images = vec![];
        for image in self.attributes.internal_images.iter() {
            images.push(get_stored_image(image.clone(), file_storage_service).await);
        }
        converted_exercise.attributes.images = images;
        // // FIXME: Remove when https://github.com/SeaQL/sea-orm/issues/1517 is fixed.
        // converted_exercise.attributes.muscles = self.muscles.0;
        converted_exercise
    }
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::user_to_exercise::Entity")]
    UserToExercise,
}

impl Related<super::user_to_exercise::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::UserToExercise.def()
    }
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        super::user_to_exercise::Relation::User.def()
    }
    fn via() -> Option<RelationDef> {
        Some(super::user_to_exercise::Relation::Exercise.def().rev())
    }
}

impl ActiveModelBehavior for ActiveModel {}
