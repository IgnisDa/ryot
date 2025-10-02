use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use common_models::EntityAssets;
use common_utils::ryot_log;
use database_models::{
    exercise,
    prelude::{Exercise, UserToEntity, Workout},
    user_to_entity,
};
use database_utils::{
    entity_in_collections_with_details, item_reviews, schedule_user_for_workout_revision,
};
use dependent_models::UserExerciseDetails;
use enum_models::{EntityLot, ExerciseLot, ExerciseSource};
use fitness_models::{
    ExerciseCategory, GithubExercise, GithubExerciseAttributes, UpdateUserExerciseSettings,
    UserToExerciseExtraInformation,
};
use futures::try_join;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
};
use supporting_service::SupportingService;

use crate::{IMAGES_PREFIX_URL, JSON_URL};

pub async fn exercise_details(
    ss: &Arc<SupportingService>,
    exercise_id: String,
) -> Result<exercise::Model> {
    Exercise::find_by_id(exercise_id)
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Exercise with the given ID could not be found."))
}

pub async fn user_exercise_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    exercise_id: String,
) -> Result<UserExerciseDetails> {
    let (collections, reviews) = try_join!(
        entity_in_collections_with_details(&user_id, &exercise_id, EntityLot::Exercise, ss),
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
    let mut ute = ute.into_active_model();
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
    let old_exercise = old_exercise.ok_or_else(|| anyhow!("Exercise does not exist"))?;
    let new_exercise = new_exercise.ok_or_else(|| anyhow!("Exercise does not exist"))?;
    if old_exercise.id == new_exercise.id {
        bail!("Cannot merge exercise with itself");
    }
    if old_exercise.lot != new_exercise.lot {
        bail!(format!(
            "Exercises must be of the same lot, got from={:#?} and into={:#?}",
            old_exercise.lot, new_exercise.lot
        ));
    }
    let old_entity = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .filter(user_to_entity::Column::ExerciseId.eq(merge_from.clone()))
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Exercise does not exist"))?;
    try_join!(
        schedule_user_for_workout_revision(&user_id, ss),
        change_exercise_id_in_history(ss, merge_into, old_entity),
    )?;
    Ok(true)
}

async fn change_exercise_id_in_history(
    ss: &Arc<SupportingService>,
    new_name: String,
    old_entity: user_to_entity::Model,
) -> Result<()> {
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
        let mut db_workout = db_workout.into_active_model();
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
                    .map(|i| format!("{IMAGES_PREFIX_URL}/{i}"))
                    .collect(),
                ..e.attributes
            },
            ..e
        })
        .collect())
}

pub async fn update_github_exercise(ss: &Arc<SupportingService>, ex: GithubExercise) -> Result<()> {
    let assets = EntityAssets {
        remote_images: ex.attributes.images,
        ..Default::default()
    };
    let instructions = ex.attributes.instructions;
    let mut muscles = ex.attributes.primary_muscles;
    muscles.extend(ex.attributes.secondary_muscles);
    if let Some(e) = Exercise::find()
        .filter(exercise::Column::Id.eq(&ex.name))
        .filter(exercise::Column::Source.eq(ExerciseSource::Github))
        .one(&ss.db)
        .await?
    {
        ryot_log!(debug, "Updating existing exercise with id: {}", ex.name);
        let mut db_ex = e.into_active_model();
        db_ex.assets = ActiveValue::Set(assets);
        db_ex.muscles = ActiveValue::Set(muscles);
        db_ex.instructions = ActiveValue::Set(instructions);
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
            assets: ActiveValue::Set(assets),
            muscles: ActiveValue::Set(muscles),
            id: ActiveValue::Set(ex.name.clone()),
            name: ActiveValue::Set(ex.name.clone()),
            created_by_user_id: ActiveValue::Set(None),
            level: ActiveValue::Set(ex.attributes.level),
            instructions: ActiveValue::Set(instructions),
            force: ActiveValue::Set(ex.attributes.force),
            source: ActiveValue::Set(ExerciseSource::Github),
            mechanic: ActiveValue::Set(ex.attributes.mechanic),
            equipment: ActiveValue::Set(ex.attributes.equipment),
        };
        let created_exercise = db_exercise.insert(&ss.db).await?;
        ryot_log!(debug, "Created exercise with id: {}", created_exercise.id);
    }
    Ok(())
}
