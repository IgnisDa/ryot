use std::sync::Arc;

use anyhow::{Result, bail};
use common_utils::ryot_log;
use database_models::{
    prelude::{Exercise, UserToEntity, Workout},
    user_to_entity, workout,
};
use database_utils::schedule_user_for_workout_revision;
use dependent_notification_utils::send_notification_for_user;
use dependent_utility_utils::{
    expire_user_exercises_list_cache, expire_user_workout_details_cache,
    expire_user_workouts_list_cache,
};
use enum_meta::Meta;
use enum_models::UserNotificationContent;
use fitness_models::{
    ExerciseBestSetRecord, ProcessedExercise, UserToExerciseBestSetExtraInformation,
    UserToExerciseExtraInformation, UserToExerciseHistoryExtraInformation, UserWorkoutInput,
    WorkoutInformation, WorkoutOrExerciseTotals, WorkoutSetRecord, WorkoutSetTotals,
    WorkoutSummary, WorkoutSummaryExercise,
};
use futures::try_join;
use itertools::Itertools;
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter,
};
use supporting_service::SupportingService;

use crate::{
    calculate_one_rm, calculate_pace, calculate_volume, clean_values, get_best_set_index,
    get_focused_workout_summary, get_index_of_highest_pb, get_personal_best,
};

/// Create a workout in the database and also update user and exercise associations.
pub async fn create_or_update_user_workout(
    user_id: &String,
    input: UserWorkoutInput,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let end_time = input.end_time;
    let mut duration: i32 = match input.duration {
        Some(d) => d.try_into().unwrap(),
        None => end_time
            .signed_duration_since(input.start_time)
            .num_seconds()
            .try_into()
            .unwrap(),
    };
    let mut input = input;
    let (new_workout_id, to_update_workout) = match &input.update_workout_id {
        Some(id) => {
            // DEV: Unwrap to make sure we error out early if the workout to edit does not exist
            let model = Workout::find_by_id(id).one(&ss.db).await?.unwrap();
            duration = model.duration;
            (id.to_owned(), Some(model))
        }
        None => (
            input
                .create_workout_id
                .clone()
                .unwrap_or_else(|| format!("wor_{}", nanoid!(12))),
            None,
        ),
    };
    ryot_log!(debug, "Creating workout with id = {}", new_workout_id);
    let mut exercises = vec![];
    let mut workout_totals = vec![];
    if input.exercises.is_empty() {
        bail!("This workout has no associated exercises");
    }
    let mut first_set_confirmed_at = input
        .exercises
        .first()
        .unwrap()
        .sets
        .first()
        .unwrap()
        .confirmed_at;
    for (exercise_idx, ex) in input.exercises.iter_mut().enumerate() {
        if ex.sets.is_empty() {
            bail!("This exercise has no associated sets");
        }
        let Some(db_ex) = Exercise::find_by_id(ex.exercise_id.clone())
            .one(&ss.db)
            .await?
        else {
            ryot_log!(debug, "Exercise with id = {} not found", ex.exercise_id);
            continue;
        };
        let mut sets = vec![];
        let mut totals = WorkoutOrExerciseTotals::default();
        let association = UserToEntity::find()
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .filter(user_to_entity::Column::ExerciseId.eq(ex.exercise_id.clone()))
            .one(&ss.db)
            .await
            .ok()
            .flatten();
        let history_item = UserToExerciseHistoryExtraInformation {
            idx: exercise_idx,
            workout_end_on: end_time,
            workout_id: new_workout_id.clone(),
            ..Default::default()
        };
        let asc = match association {
            Some(e) => e,
            None => {
                let timestamp = first_set_confirmed_at.unwrap_or(end_time);
                let user_to_ex = user_to_entity::ActiveModel {
                    created_on: ActiveValue::Set(timestamp),
                    user_id: ActiveValue::Set(user_id.clone()),
                    last_updated_on: ActiveValue::Set(timestamp),
                    exercise_id: ActiveValue::Set(Some(ex.exercise_id.clone())),
                    exercise_extra_information: ActiveValue::Set(Some(
                        UserToExerciseExtraInformation::default(),
                    )),
                    ..Default::default()
                };
                user_to_ex.insert(&ss.db).await?
            }
        };
        let last_updated_on = asc.last_updated_on;
        let mut extra_info = asc.exercise_extra_information.clone().unwrap_or_default();
        extra_info.history.insert(0, history_item);
        let mut to_update = asc.into_active_model();
        to_update.exercise_num_times_interacted =
            ActiveValue::Set(Some(extra_info.history.len().try_into().unwrap()));
        to_update.exercise_extra_information = ActiveValue::Set(Some(extra_info));
        to_update.last_updated_on =
            ActiveValue::Set(first_set_confirmed_at.unwrap_or(last_updated_on));
        let association = to_update.update(&ss.db).await?;
        totals.rest_time = ex
            .sets
            .iter()
            .map(|s| s.rest_time.unwrap_or_default())
            .sum();
        ex.sets
            .sort_unstable_by_key(|s| s.confirmed_at.unwrap_or_default());
        for set in ex.sets.iter_mut() {
            first_set_confirmed_at = set.confirmed_at;
            clean_values(set, &db_ex.lot);
            if let Some(r) = set.statistic.reps {
                totals.reps += r;
                if let Some(w) = set.statistic.weight {
                    totals.weight += w * r;
                }
            }
            if let Some(d) = set.statistic.duration {
                totals.duration += d;
            }
            if let Some(d) = set.statistic.distance {
                totals.distance += d;
            }
            let mut totals = WorkoutSetTotals::default();
            if let (Some(we), Some(re)) = (&set.statistic.weight, &set.statistic.reps) {
                totals.weight = Some(we * re);
            }
            let mut value = WorkoutSetRecord {
                lot: set.lot,
                rpe: set.rpe,
                totals: Some(totals),
                note: set.note.clone(),
                rest_time: set.rest_time,
                personal_bests: Some(vec![]),
                confirmed_at: set.confirmed_at,
                statistic: set.statistic.clone(),
                rest_timer_started_at: set.rest_timer_started_at,
            };
            value.statistic.one_rm = calculate_one_rm(&value);
            value.statistic.pace = calculate_pace(&value);
            value.statistic.volume = calculate_volume(&value);
            sets.push(value);
        }
        let mut personal_bests = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default()
            .personal_bests;
        let types_of_prs = db_ex.lot.meta();
        for best_type in types_of_prs.iter() {
            let set_idx = get_index_of_highest_pb(&sets, best_type).unwrap();
            let possible_record = personal_bests
                .iter()
                .find(|pb| pb.lot == *best_type)
                .and_then(|record| record.sets.first());
            let set = sets.get_mut(set_idx).unwrap();
            if let Some(r) = possible_record {
                if let Some(workout) = Workout::find_by_id(r.workout_id.clone())
                    .one(&ss.db)
                    .await?
                {
                    let workout_set = workout
                        .information
                        .exercises
                        .get(r.exercise_idx)
                        .and_then(|exercise| exercise.sets.get(r.set_idx));
                    let workout_set = match workout_set {
                        Some(s) => s,
                        None => {
                            ryot_log!(debug, "Workout set {} does not exist", r.set_idx);
                            continue;
                        }
                    };
                    if get_personal_best(set, best_type) > get_personal_best(workout_set, best_type)
                    {
                        if let Some(ref mut set_personal_bests) = set.personal_bests {
                            set_personal_bests.push(*best_type);
                        }
                        totals.personal_bests_achieved += 1;
                    }
                }
            } else {
                if let Some(ref mut set_personal_bests) = set.personal_bests {
                    set_personal_bests.push(*best_type);
                }
                totals.personal_bests_achieved += 1;
            }
        }
        workout_totals.push(totals.clone());
        for (set_idx, set) in sets.iter().enumerate() {
            if let Some(set_personal_bests) = &set.personal_bests {
                for best in set_personal_bests.iter() {
                    let to_insert_record = ExerciseBestSetRecord {
                        set_idx,
                        exercise_idx,
                        workout_id: new_workout_id.clone(),
                    };
                    if let Some(record) = personal_bests.iter_mut().find(|pb| pb.lot == *best) {
                        let mut data = record.sets.clone();
                        data.insert(0, to_insert_record);
                        record.sets = data;
                    } else {
                        personal_bests.push(UserToExerciseBestSetExtraInformation {
                            lot: *best,
                            sets: vec![to_insert_record],
                        });
                    }
                }
            }
        }
        let best_set = get_best_set_index(&sets).and_then(|i| sets.get(i).cloned());
        let mut association_extra_information = association
            .exercise_extra_information
            .clone()
            .unwrap_or_default();
        association_extra_information.history[0].best_set = best_set.clone();
        let mut association = association.into_active_model();
        association_extra_information.lifetime_stats += totals.clone();
        association_extra_information.personal_bests = personal_bests;
        association.exercise_extra_information =
            ActiveValue::Set(Some(association_extra_information));
        association.update(&ss.db).await?;
        exercises.push((
            best_set,
            db_ex.lot,
            ProcessedExercise {
                sets,
                id: db_ex.id,
                lot: db_ex.lot,
                total: Some(totals),
                notes: ex.notes.clone(),
                assets: ex.assets.clone(),
                unit_system: ex.unit_system,
            },
        ));
    }
    input.supersets.retain(|s| {
        s.exercises.len() > 1
            && s.exercises
                .iter()
                .all(|s| exercises.get(*s as usize).is_some())
    });
    let summary_total = workout_totals.into_iter().sum();
    let processed_exercises = exercises
        .clone()
        .into_iter()
        .map(|(_, _, ex)| ex)
        .collect_vec();
    let focused = get_focused_workout_summary(&processed_exercises, ss).await?;
    let model = workout::Model {
        end_time,
        duration,
        name: input.name,
        user_id: user_id.clone(),
        id: new_workout_id.clone(),
        start_time: input.start_time,
        template_id: input.template_id,
        repeated_from: input.repeated_from,
        calories_burnt: input.calories_burnt,
        information: WorkoutInformation {
            assets: input.assets,
            comment: input.comment,
            supersets: input.supersets,
            exercises: processed_exercises,
        },
        summary: WorkoutSummary {
            focused,
            total: Some(summary_total),
            exercises: exercises
                .clone()
                .into_iter()
                .map(|(best_set, lot, e)| WorkoutSummaryExercise {
                    best_set,
                    lot: Some(lot),
                    id: e.id.clone(),
                    num_sets: e.sets.len(),
                    unit_system: e.unit_system,
                })
                .collect(),
        },
    };
    let mut insert = model.into_active_model();
    if let Some(old_workout) = to_update_workout.clone() {
        insert.end_time = ActiveValue::Set(old_workout.end_time);
        insert.start_time = ActiveValue::Set(old_workout.start_time);
        insert.repeated_from = ActiveValue::Set(old_workout.repeated_from.clone());
        old_workout.delete(&ss.db).await?;
    }
    let data = insert.insert(&ss.db).await?;
    match to_update_workout {
        Some(_) => schedule_user_for_workout_revision(user_id, ss).await?,
        None => {
            if input.create_workout_id.is_none() {
                send_notification_for_user(
                    user_id,
                    ss,
                    UserNotificationContent::NewWorkoutCreated {
                        workout_id: data.id.to_string(),
                        workout_name: data.name.clone(),
                    },
                )
                .await?
            }
        }
    };
    try_join!(
        expire_user_workouts_list_cache(user_id, ss),
        expire_user_exercises_list_cache(user_id, ss),
        expire_user_workout_details_cache(user_id, &data.id, ss)
    )?;
    Ok(data.id)
}
