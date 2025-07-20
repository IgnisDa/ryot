use std::sync::Arc;

use anyhow::{Result, bail};
use common_utils::ryot_log;
use database_models::{
    prelude::{UserToEntity, Workout},
    user_to_entity, workout,
};
use database_utils::{
    schedule_user_for_workout_revision, user_workout_details as get_user_workout_details,
};
use dependent_models::{
    CachedResponse, UserTemplatesOrWorkoutsListInput, UserWorkoutDetails, UserWorkoutsListResponse,
};
use dependent_utils::{
    create_or_update_user_workout as create_or_update_user_workout_util,
    db_workout_to_workout_input, expire_user_workouts_list_cache,
    user_workouts_list as get_user_workouts_list,
};
use fitness_models::{
    UpdateUserWorkoutAttributesInput, UserToExerciseExtraInformation, UserWorkoutInput,
};
use futures::{TryStreamExt, try_join};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter, QueryOrder,
};
use supporting_service::SupportingService;

pub async fn user_workout_details(
    ss: &Arc<SupportingService>,
    user_id: &String,
    workout_id: String,
) -> Result<UserWorkoutDetails> {
    get_user_workout_details(user_id, workout_id, ss).await
}

pub async fn user_workouts_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsListResponse>> {
    get_user_workouts_list(&user_id, input, ss).await
}

pub async fn create_or_update_user_workout(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserWorkoutInput,
) -> Result<String> {
    create_or_update_user_workout_util(user_id, input, ss).await
}

pub async fn update_user_workout_attributes(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UpdateUserWorkoutAttributesInput,
) -> Result<bool> {
    let Some(wkt) = Workout::find()
        .filter(workout::Column::UserId.eq(&user_id))
        .filter(workout::Column::Id.eq(input.id))
        .one(&ss.db)
        .await?
    else {
        bail!("Workout does not exist for user");
    };
    let mut new_wkt: workout::ActiveModel = wkt.into();
    if let Some(d) = input.start_time {
        new_wkt.start_time = ActiveValue::Set(d);
    }
    if let Some(d) = input.end_time {
        new_wkt.end_time = ActiveValue::Set(d);
    }
    if new_wkt.is_changed() {
        let new_workout = new_wkt.update(&ss.db).await?;
        let new_duration = new_workout
            .end_time
            .signed_duration_since(new_workout.start_time)
            .num_seconds();
        let mut new_workout: workout::ActiveModel = new_workout.into();
        new_workout.duration = ActiveValue::Set(new_duration.try_into().unwrap());
        new_workout.update(&ss.db).await?;
        schedule_user_for_workout_revision(&user_id, ss).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

pub async fn delete_user_workout(
    ss: &Arc<SupportingService>,
    user_id: String,
    workout_id: String,
) -> Result<bool> {
    let Some(wkt) = Workout::find_by_id(workout_id)
        .filter(workout::Column::UserId.eq(&user_id))
        .one(&ss.db)
        .await?
    else {
        bail!("Workout does not exist for user");
    };
    for (idx, ex) in wkt.information.exercises.iter().enumerate() {
        let Some(association) = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(&user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(ex.id.clone()))
            .one(&ss.db)
            .await?
        else {
            continue;
        };
        let mut ei = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default();
        if let Some(ex_idx) = ei
            .history
            .iter()
            .position(|e| e.workout_id == wkt.id && e.idx == idx)
        {
            ei.history.remove(ex_idx);
        }
        let mut association: user_to_entity::ActiveModel = association.into();
        association.exercise_extra_information = ActiveValue::Set(Some(ei));
        association.update(&ss.db).await?;
    }
    wkt.delete(&ss.db).await?;
    try_join!(
        expire_user_workouts_list_cache(&user_id, ss),
        schedule_user_for_workout_revision(&user_id, ss)
    )?;
    Ok(true)
}

pub async fn revise_user_workouts(ss: &Arc<SupportingService>, user_id: String) -> Result<()> {
    let mut all_stream = UserToEntity::find()
        .filter(user_to_entity::Column::UserId.eq(&user_id))
        .filter(user_to_entity::Column::ExerciseId.is_not_null())
        .stream(&ss.db)
        .await?;
    while let Some(ute) = all_stream.try_next().await? {
        let mut new = UserToExerciseExtraInformation::default();
        let eei = ute.exercise_extra_information.clone().unwrap_or_default();
        new.settings = eei.settings;
        let mut ute: user_to_entity::ActiveModel = ute.into();
        ute.exercise_num_times_interacted = ActiveValue::Set(None);
        ute.exercise_extra_information = ActiveValue::Set(Some(new));
        ute.update(&ss.db).await?;
    }
    let workouts = Workout::find()
        .filter(workout::Column::UserId.eq(&user_id))
        .order_by_asc(workout::Column::EndTime)
        .all(&ss.db)
        .await?;
    let total = workouts.len();
    for (idx, workout) in workouts.into_iter().enumerate() {
        workout.clone().delete(&ss.db).await?;
        let workout_input = db_workout_to_workout_input(workout);
        create_or_update_user_workout_util(&user_id, workout_input, ss).await?;
        ryot_log!(debug, "Revised workout: {}/{}", idx + 1, total);
    }
    Ok(())
}
