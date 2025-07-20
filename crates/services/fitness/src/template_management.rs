use anyhow::{Result, anyhow, bail};
use database_models::{
    exercise,
    prelude::{Exercise, WorkoutTemplate},
    workout_template,
};
use database_utils::{
    server_key_validation_guard, user_workout_template_details as get_user_workout_template_details,
};
use dependent_models::{
    CachedResponse, UserTemplatesOrWorkoutsListInput, UserWorkoutTemplateDetails,
    UserWorkoutsTemplatesListResponse,
};
use dependent_utils::{
    expire_user_workout_templates_list_cache, get_focused_workout_summary_with_exercises,
    user_workout_templates_list as get_user_workout_templates_list,
};
use fitness_models::{
    ProcessedExercise, UserWorkoutInput, WorkoutInformation, WorkoutSetRecord, WorkoutSummary,
    WorkoutSummaryExercise,
};
use nanoid::nanoid;
use sea_orm::{ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use sea_query::OnConflict;
use std::{collections::HashMap, sync::Arc};
use supporting_service::SupportingService;

pub async fn user_workout_templates_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
    get_user_workout_templates_list(&user_id, ss, input).await
}

pub async fn user_workout_template_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    workout_template_id: String,
) -> Result<UserWorkoutTemplateDetails> {
    get_user_workout_template_details(&ss.db, &user_id, workout_template_id).await
}

pub async fn create_or_update_user_workout_template(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: UserWorkoutInput,
) -> Result<String> {
    server_key_validation_guard(ss.is_server_key_validated().await?).await?;
    let mut summary = WorkoutSummary::default();
    let mut information = WorkoutInformation {
        comment: input.comment,
        supersets: input.supersets,
        ..Default::default()
    };

    let exercise_ids: Vec<String> = input
        .exercises
        .iter()
        .map(|e| e.exercise_id.clone())
        .collect();
    let db_exercises = Exercise::find()
        .filter(exercise::Column::Id.is_in(exercise_ids))
        .all(&ss.db)
        .await?;

    let exercise_map: HashMap<String, &exercise::Model> =
        db_exercises.iter().map(|e| (e.id.clone(), e)).collect();

    for exercise in input.exercises {
        let db_ex = exercise_map.get(&exercise.exercise_id).ok_or_else(|| {
            anyhow!(format!(
                "Exercise with ID {} not found",
                exercise.exercise_id
            ))
        })?;

        summary.exercises.push(WorkoutSummaryExercise {
            num_sets: exercise.sets.len(),
            id: exercise.exercise_id.clone(),
            ..Default::default()
        });
        information.exercises.push(ProcessedExercise {
            lot: db_ex.lot,
            notes: exercise.notes,
            id: exercise.exercise_id,
            unit_system: exercise.unit_system,
            sets: exercise
                .sets
                .into_iter()
                .map(|s| WorkoutSetRecord {
                    lot: s.lot,
                    rpe: s.rpe,
                    note: s.note,
                    rest_time: s.rest_time,
                    statistic: s.statistic,
                    rest_timer_started_at: s.rest_timer_started_at,
                    ..Default::default()
                })
                .collect(),
            ..Default::default()
        });
    }
    let processed_exercises = information.exercises.clone();
    summary.focused =
        get_focused_workout_summary_with_exercises(&processed_exercises, &db_exercises)?;
    let template = workout_template::ActiveModel {
        name: ActiveValue::Set(input.name),
        summary: ActiveValue::Set(summary),
        user_id: ActiveValue::Set(user_id.clone()),
        information: ActiveValue::Set(information),
        id: match input.update_workout_template_id {
            Some(id) => ActiveValue::Set(id),
            None => ActiveValue::Set(format!("wktpl_{}", nanoid!(12))),
        },
        ..Default::default()
    };
    let template = WorkoutTemplate::insert(template)
        .on_conflict(
            OnConflict::column(workout_template::Column::Id)
                .update_columns([
                    workout_template::Column::Name,
                    workout_template::Column::Summary,
                    workout_template::Column::Information,
                ])
                .to_owned(),
        )
        .exec_with_returning(&ss.db)
        .await?;
    expire_user_workout_templates_list_cache(&user_id, ss).await?;
    Ok(template.id)
}

pub async fn delete_user_workout_template(
    ss: &Arc<SupportingService>,
    user_id: String,
    workout_template_id: String,
) -> Result<bool> {
    server_key_validation_guard(ss.is_server_key_validated().await?).await?;
    let Some(wkt) = WorkoutTemplate::find_by_id(workout_template_id)
        .filter(workout_template::Column::UserId.eq(&user_id))
        .one(&ss.db)
        .await?
    else {
        bail!("Workout template does not exist for user");
    };
    wkt.delete(&ss.db).await?;
    expire_user_workout_templates_list_cache(&user_id, ss).await?;
    Ok(true)
}
