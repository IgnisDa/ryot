use async_graphql::{Error, Result};
use common_models::EntityAssets;
use common_utils::ryot_log;
use database_models::{
    exercise,
    prelude::{Exercise, UserToEntity},
    user_to_entity,
};
use database_utils::{
    entity_in_collections_with_details, item_reviews, schedule_user_for_workout_revision,
    transform_entity_assets,
};
use dependent_models::{
    CachedResponse, UpdateCustomExerciseInput, UserExerciseDetails, UserExercisesListResponse,
};
use dependent_utils::{
    create_custom_exercise as create_custom_exercise_util,
    user_exercises_list as get_user_exercises_list,
};
use enum_models::{EntityLot, ExerciseLot, ExerciseSource};
use fitness_models::{
    ExerciseAttributes, ExerciseCategory, GithubExercise, GithubExerciseAttributes,
    UpdateUserExerciseSettings, UserExercisesListInput, UserToExerciseExtraInformation,
};
use futures::try_join;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use std::sync::Arc;
use supporting_service::SupportingService;

use crate::{IMAGES_PREFIX_URL, JSON_URL};

pub async fn exercise_details(
    ss: &Arc<SupportingService>,
    exercise_id: String,
) -> Result<exercise::Model> {
    let maybe_exercise = Exercise::find_by_id(exercise_id).one(&ss.db).await?;
    match maybe_exercise {
        None => Err(Error::new("Exercise with the given ID could not be found.")),
        Some(mut e) => {
            transform_entity_assets(&mut e.attributes.assets, ss).await?;
            Ok(e)
        }
    }
}

pub async fn user_exercise_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    exercise_id: String,
) -> Result<UserExerciseDetails> {
    let (collections, reviews) = try_join!(
        entity_in_collections_with_details(&ss.db, &user_id, &exercise_id, EntityLot::Exercise),
        item_reviews(&user_id, &exercise_id, EntityLot::Exercise, true, ss)
    )?;
    let mut resp = UserExerciseDetails {
        collections,
        reviews,
        ..Default::default()
    };
    if let Some(association) = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .filter(user_to_entity::Column::ExerciseId.eq(exercise_id))
        .one(&ss.db)
        .await?
    {
        let user_to_exercise_extra_information = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default();
        resp.history = Some(user_to_exercise_extra_information.history);
        resp.details = Some(association);
    }
    Ok(resp)
}

pub async fn user_exercises_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserExercisesListInput,
) -> Result<CachedResponse<UserExercisesListResponse>> {
    get_user_exercises_list(&user_id, input, ss).await
}

pub async fn create_custom_exercise(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: exercise::Model,
) -> Result<String> {
    create_custom_exercise_util(user_id, input, ss).await
}

pub async fn update_custom_exercise(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UpdateCustomExerciseInput,
) -> Result<bool> {
    let id = input.update.id.clone();
    let mut update = input.update.clone();
    let old_exercise = Exercise::find_by_id(&id).one(&ss.db).await?.unwrap();
    for image in old_exercise.attributes.assets.s3_images.clone() {
        ss.file_storage_service.delete_object(image).await;
    }
    if input.should_delete.unwrap_or_default() {
        let ute = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(&id))
            .one(&ss.db)
            .await?
            .ok_or_else(|| Error::new("Exercise does not exist"))?;
        if let Some(exercise_extra_information) = ute.exercise_extra_information {
            if !exercise_extra_information.history.is_empty() {
                return Err(Error::new(
                    "Exercise is associated with one or more workouts.",
                ));
            }
        }
        old_exercise.delete(&ss.db).await?;
        return Ok(true);
    }
    update.source = ExerciseSource::Custom;
    update.created_by_user_id = Some(user_id.clone());
    let input: exercise::ActiveModel = update.into();
    let mut input = input.reset_all();
    input.id = ActiveValue::Unchanged(id);
    input.update(&ss.db).await?;
    Ok(true)
}

pub async fn update_user_exercise_settings(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UpdateUserExerciseSettings,
) -> Result<bool> {
    let ute = match UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .filter(user_to_entity::Column::ExerciseId.eq(&input.exercise_id))
        .one(&ss.db)
        .await?
    {
        Some(ute) => ute,
        None => {
            let data = user_to_entity::ActiveModel {
                user_id: ActiveValue::Set(user_id),
                exercise_id: ActiveValue::Set(Some(input.exercise_id)),
                exercise_extra_information: ActiveValue::Set(Some(
                    UserToExerciseExtraInformation::default(),
                )),
                ..Default::default()
            };
            data.insert(&ss.db).await?
        }
    };
    let mut exercise_extra_information = ute.clone().exercise_extra_information.unwrap();
    exercise_extra_information.settings = input.change;
    let mut ute: user_to_entity::ActiveModel = ute.into();
    ute.exercise_extra_information = ActiveValue::Set(Some(exercise_extra_information));
    ute.update(&ss.db).await?;
    Ok(true)
}

pub async fn merge_exercise(
    ss: &Arc<SupportingService>,
    user_id: String,
    merge_from: String,
    merge_into: String,
) -> Result<bool> {
    let (old_exercise, new_exercise) = try_join!(
        Exercise::find_by_id(merge_from.clone()).one(&ss.db),
        Exercise::find_by_id(merge_into.clone()).one(&ss.db)
    )?;
    let old_exercise = old_exercise.ok_or_else(|| Error::new("Exercise does not exist"))?;
    let new_exercise = new_exercise.ok_or_else(|| Error::new("Exercise does not exist"))?;
    if old_exercise.id == new_exercise.id {
        return Err(Error::new("Cannot merge exercise with itself"));
    }
    if old_exercise.lot != new_exercise.lot {
        return Err(Error::new(format!(
            "Exercises must be of the same lot, got from={:#?} and into={:#?}",
            old_exercise.lot, new_exercise.lot
        )));
    }
    let old_entity = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .filter(user_to_entity::Column::ExerciseId.eq(merge_from.clone()))
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Exercise does not exist"))?;
    change_exercise_id_in_history(ss, merge_into, old_entity).await?;
    schedule_user_for_workout_revision(&user_id, ss).await?;
    Ok(true)
}

async fn change_exercise_id_in_history(
    ss: &Arc<SupportingService>,
    new_name: String,
    old_entity: user_to_entity::Model,
) -> Result<()> {
    use database_models::{prelude::Workout, workout};

    let Some(exercise_extra_information) = old_entity.exercise_extra_information else {
        return Ok(());
    };
    for workout in exercise_extra_information.history {
        let db_workout = Workout::find_by_id(workout.workout_id)
            .one(&ss.db)
            .await?
            .unwrap();
        let mut summary = db_workout.summary.clone();
        let mut information = db_workout.information.clone();
        summary.exercises[workout.idx].id = new_name.clone();
        information.exercises[workout.idx].id = new_name.clone();
        let mut db_workout: workout::ActiveModel = db_workout.into();
        db_workout.summary = ActiveValue::Set(summary);
        db_workout.information = ActiveValue::Set(information);
        db_workout.update(&ss.db).await?;
    }
    Ok(())
}

pub async fn get_all_exercises_from_dataset(
    _ss: &Arc<SupportingService>,
) -> Result<Vec<GithubExercise>> {
    let data = reqwest::get(JSON_URL)
        .await
        .unwrap()
        .json::<Vec<GithubExercise>>()
        .await
        .unwrap();
    Ok(data
        .into_iter()
        .map(|e| GithubExercise {
            attributes: GithubExerciseAttributes {
                images: e
                    .attributes
                    .images
                    .into_iter()
                    .map(|i| format!("{}/{}", IMAGES_PREFIX_URL, i))
                    .collect(),
                ..e.attributes
            },
            ..e
        })
        .collect())
}

pub async fn update_github_exercise(ss: &Arc<SupportingService>, ex: GithubExercise) -> Result<()> {
    let attributes = ExerciseAttributes {
        instructions: ex.attributes.instructions,
        assets: EntityAssets {
            remote_images: ex.attributes.images,
            ..Default::default()
        },
    };
    let mut muscles = ex.attributes.primary_muscles;
    muscles.extend(ex.attributes.secondary_muscles);
    if let Some(e) = Exercise::find()
        .filter(exercise::Column::Id.eq(&ex.name))
        .filter(exercise::Column::Source.eq(ExerciseSource::Github))
        .one(&ss.db)
        .await?
    {
        ryot_log!(debug, "Updating existing exercise with id: {}", ex.name);
        let mut db_ex: exercise::ActiveModel = e.into();
        db_ex.attributes = ActiveValue::Set(attributes);
        db_ex.muscles = ActiveValue::Set(muscles);
        db_ex.update(&ss.db).await?;
    } else {
        let lot = match ex.attributes.category {
            ExerciseCategory::Cardio => ExerciseLot::DistanceAndDuration,
            ExerciseCategory::Stretching | ExerciseCategory::Plyometrics => ExerciseLot::Duration,
            ExerciseCategory::Strongman
            | ExerciseCategory::OlympicWeightlifting
            | ExerciseCategory::Strength
            | ExerciseCategory::Powerlifting => ExerciseLot::RepsAndWeight,
        };
        let db_exercise = exercise::ActiveModel {
            lot: ActiveValue::Set(lot),
            muscles: ActiveValue::Set(muscles),
            id: ActiveValue::Set(ex.name.clone()),
            name: ActiveValue::Set(ex.name.clone()),
            attributes: ActiveValue::Set(attributes),
            created_by_user_id: ActiveValue::Set(None),
            level: ActiveValue::Set(ex.attributes.level),
            force: ActiveValue::Set(ex.attributes.force),
            source: ActiveValue::Set(ExerciseSource::Github),
            equipment: ActiveValue::Set(ex.attributes.equipment),
            mechanic: ActiveValue::Set(ex.attributes.mechanic),
        };
        let created_exercise = db_exercise.insert(&ss.db).await?;
        ryot_log!(debug, "Created exercise with id: {}", created_exercise.id);
    }
    Ok(())
}
