use std::{collections::HashMap, sync::Arc};

use async_graphql::{Error, Result};
use common_models::{ChangeCollectionToEntitiesInput, DefaultCollection, EntityToCollectionInput};
use common_utils::ryot_log;
use database_models::{exercise, prelude::*, user, user_measurement, user_to_entity, workout};
use database_utils::{schedule_user_for_workout_revision, user_by_id};
use enum_meta::Meta;
use enum_models::{
    EntityLot, ExerciseLot, ExerciseSource, UserNotificationContent, WorkoutSetPersonalBest,
};
use fitness_models::{
    ExerciseBestSetRecord, ProcessedExercise, UserExerciseInput,
    UserToExerciseBestSetExtraInformation, UserToExerciseExtraInformation,
    UserToExerciseHistoryExtraInformation, UserWorkoutInput, UserWorkoutSetRecord,
    WorkoutEquipmentFocusedSummary, WorkoutFocusedSummary, WorkoutForceFocusedSummary,
    WorkoutInformation, WorkoutLevelFocusedSummary, WorkoutLotFocusedSummary,
    WorkoutMuscleFocusedSummary, WorkoutOrExerciseTotals, WorkoutSetRecord, WorkoutSetStatistic,
    WorkoutSetTotals, WorkoutSummary, WorkoutSummaryExercise,
};
use itertools::Itertools;
use nanoid::nanoid;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter,
    prelude::DateTimeUtc,
};
use std::cmp::Reverse;
use supporting_service::SupportingService;
use user_models::UserStatisticsMeasurement;

use crate::{
    collection_operations::add_entities_to_collection,
    notification_operations::send_notification_for_user,
    utility_operations::{expire_user_measurements_list_cache, expire_user_workouts_list_cache},
};

pub async fn create_user_measurement(
    user_id: &String,
    mut input: user_measurement::Model,
    ss: &Arc<SupportingService>,
) -> Result<DateTimeUtc> {
    input.user_id = user_id.to_owned();

    let mut user = user_by_id(user_id, ss).await?;

    let mut needs_to_update_preferences = false;
    for measurement in input.information.statistics.iter() {
        let already_in_preferences = user
            .preferences
            .fitness
            .measurements
            .statistics
            .iter()
            .any(|stat| stat.name == measurement.name);
        if !already_in_preferences {
            user.preferences
                .fitness
                .measurements
                .statistics
                .push(UserStatisticsMeasurement {
                    name: measurement.name.clone(),
                    ..Default::default()
                });
            needs_to_update_preferences = true;
        }
    }

    if needs_to_update_preferences {
        let mut user_model: user::ActiveModel = user.clone().into();
        user_model.preferences = ActiveValue::Set(user.preferences);
        user_model.update(&ss.db).await?;
    }

    let um: user_measurement::ActiveModel = input.into();
    let um = um.insert(&ss.db).await?;
    expire_user_measurements_list_cache(user_id, ss).await?;
    Ok(um.timestamp)
}

pub fn get_best_set_index(records: &[WorkoutSetRecord]) -> Option<usize> {
    let record = records.iter().enumerate().max_by_key(|(_, record)| {
        record.statistic.duration.unwrap_or(dec!(0))
            + record.statistic.distance.unwrap_or(dec!(0))
            + record.statistic.reps.unwrap_or(dec!(0))
            + record.statistic.weight.unwrap_or(dec!(0))
    });
    record.and_then(|(_, r)| records.iter().position(|l| l.statistic == r.statistic))
}

pub fn get_index_of_highest_pb(
    records: &[WorkoutSetRecord],
    pb_type: &WorkoutSetPersonalBest,
) -> Option<usize> {
    let record = records
        .iter()
        .max_by_key(|record| get_personal_best(record, pb_type).unwrap_or(dec!(0)));
    record.and_then(|r| records.iter().position(|l| l.statistic == r.statistic))
}

pub fn calculate_one_rm(value: &WorkoutSetRecord) -> Option<Decimal> {
    let weight = value.statistic.weight?;
    let reps = value.statistic.reps?;
    let val = match reps < dec!(10) {
        true => (weight * dec!(36.0)).checked_div(dec!(37.0) - reps), // Brzycki
        false => weight.checked_mul((dec!(1).checked_add(reps.checked_div(dec!(30))?))?), // Epley
    };
    val.filter(|v| v <= &dec!(0))
}

pub fn calculate_volume(value: &WorkoutSetRecord) -> Option<Decimal> {
    Some(value.statistic.weight? * value.statistic.reps?)
}

pub fn calculate_pace(value: &WorkoutSetRecord) -> Option<Decimal> {
    value
        .statistic
        .distance?
        .checked_div(value.statistic.duration?)
}

pub fn get_personal_best(
    value: &WorkoutSetRecord,
    pb_type: &WorkoutSetPersonalBest,
) -> Option<Decimal> {
    match pb_type {
        WorkoutSetPersonalBest::Reps => value.statistic.reps,
        WorkoutSetPersonalBest::Pace => calculate_pace(value),
        WorkoutSetPersonalBest::OneRm => calculate_one_rm(value),
        WorkoutSetPersonalBest::Time => value.statistic.duration,
        WorkoutSetPersonalBest::Weight => value.statistic.weight,
        WorkoutSetPersonalBest::Volume => calculate_volume(value),
        WorkoutSetPersonalBest::Distance => value.statistic.distance,
    }
}

/// Set the invalid statistics to `None` according to the type of exercise.
pub fn clean_values(value: &mut UserWorkoutSetRecord, exercise_lot: &ExerciseLot) {
    let mut stats = WorkoutSetStatistic::default();
    match exercise_lot {
        ExerciseLot::Reps => {
            stats.reps = value.statistic.reps;
        }
        ExerciseLot::Duration => {
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::RepsAndDuration => {
            stats.reps = value.statistic.reps;
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::DistanceAndDuration => {
            stats.distance = value.statistic.distance;
            stats.duration = value.statistic.duration;
        }
        ExerciseLot::RepsAndWeight => {
            stats.reps = value.statistic.reps;
            stats.weight = value.statistic.weight;
        }
        ExerciseLot::RepsAndDurationAndDistance => {
            stats.reps = value.statistic.reps;
            stats.duration = value.statistic.duration;
            stats.distance = value.statistic.distance;
        }
    }
    value.statistic = stats;
}

pub async fn get_focused_workout_summary(
    exercises: &[ProcessedExercise],
    ss: &Arc<SupportingService>,
) -> Result<WorkoutFocusedSummary> {
    let db_exercises = Exercise::find()
        .filter(exercise::Column::Id.is_in(exercises.iter().map(|e| e.id.clone())))
        .all(&ss.db)
        .await?;
    let mut lots = HashMap::new();
    let mut levels = HashMap::new();
    let mut forces = HashMap::new();
    let mut muscles = HashMap::new();
    let mut equipments = HashMap::new();
    for (idx, ex) in exercises.iter().enumerate() {
        let exercise = db_exercises.iter().find(|e| e.id == ex.id).unwrap();
        lots.entry(exercise.lot).or_insert(vec![]).push(idx);
        levels.entry(exercise.level).or_insert(vec![]).push(idx);
        if let Some(force) = exercise.force {
            forces.entry(force).or_insert(vec![]).push(idx);
        }
        if let Some(equipment) = exercise.equipment {
            equipments.entry(equipment).or_insert(vec![]).push(idx);
        }
        exercise.muscles.iter().for_each(|m| {
            muscles.entry(*m).or_insert(vec![]).push(idx);
        });
    }
    let lots = lots
        .into_iter()
        .map(|(lot, exercises)| WorkoutLotFocusedSummary { lot, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let levels = levels
        .into_iter()
        .map(|(level, exercises)| WorkoutLevelFocusedSummary { level, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let forces = forces
        .into_iter()
        .map(|(force, exercises)| WorkoutForceFocusedSummary { force, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let muscles = muscles
        .into_iter()
        .map(|(muscle, exercises)| WorkoutMuscleFocusedSummary { muscle, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let equipments = equipments
        .into_iter()
        .map(|(equipment, exercises)| WorkoutEquipmentFocusedSummary {
            equipment,
            exercises,
        })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    Ok(WorkoutFocusedSummary {
        lots,
        levels,
        forces,
        muscles,
        equipments,
    })
}

/// Generate focused workout summary from pre-fetched exercise data.
/// This version avoids redundant database queries when exercise data is already available.
pub fn get_focused_workout_summary_with_exercises(
    exercises: &[ProcessedExercise],
    db_exercises: &[exercise::Model],
) -> Result<WorkoutFocusedSummary> {
    let mut lots = HashMap::new();
    let mut levels = HashMap::new();
    let mut forces = HashMap::new();
    let mut muscles = HashMap::new();
    let mut equipments = HashMap::new();

    for (idx, ex) in exercises.iter().enumerate() {
        let exercise = db_exercises.iter().find(|e| e.id == ex.id).ok_or_else(|| {
            Error::new(format!(
                "Exercise with ID {} not found in fetched data",
                ex.id
            ))
        })?;
        lots.entry(exercise.lot).or_insert(vec![]).push(idx);
        levels.entry(exercise.level).or_insert(vec![]).push(idx);
        if let Some(force) = exercise.force {
            forces.entry(force).or_insert(vec![]).push(idx);
        }
        if let Some(equipment) = exercise.equipment {
            equipments.entry(equipment).or_insert(vec![]).push(idx);
        }
        exercise.muscles.iter().for_each(|m| {
            muscles.entry(*m).or_insert(vec![]).push(idx);
        });
    }

    let lots = lots
        .into_iter()
        .map(|(lot, exercises)| WorkoutLotFocusedSummary { lot, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let levels = levels
        .into_iter()
        .map(|(level, exercises)| WorkoutLevelFocusedSummary { level, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let forces = forces
        .into_iter()
        .map(|(force, exercises)| WorkoutForceFocusedSummary { force, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let muscles = muscles
        .into_iter()
        .map(|(muscle, exercises)| WorkoutMuscleFocusedSummary { muscle, exercises })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();
    let equipments = equipments
        .into_iter()
        .map(|(equipment, exercises)| WorkoutEquipmentFocusedSummary {
            equipment,
            exercises,
        })
        .sorted_by_key(|f| Reverse(f.exercises.len()))
        .collect();

    Ok(WorkoutFocusedSummary {
        lots,
        levels,
        forces,
        muscles,
        equipments,
    })
}

pub fn generate_exercise_id(name: &str, lot: ExerciseLot, user_id: &str) -> String {
    format!("{}_{}_{}", name, lot, user_id)
}

pub async fn create_custom_exercise(
    user_id: &String,
    input: exercise::Model,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let mut input = input;
    input.source = ExerciseSource::Custom;
    input.created_by_user_id = Some(user_id.clone());
    input.id = generate_exercise_id(&input.name, input.lot, user_id);
    let input: exercise::ActiveModel = input.into();

    let exercise = input.insert(&ss.db).await?;
    ryot_log!(debug, "Created custom exercise with id = {}", exercise.id);
    add_entities_to_collection(
        &user_id.clone(),
        ChangeCollectionToEntitiesInput {
            entities: vec![EntityToCollectionInput {
                entity_id: exercise.id.clone(),
                entity_lot: EntityLot::Exercise,
                information: None,
            }],
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
        },
        ss,
    )
    .await?;
    Ok(exercise.id)
}

pub fn db_workout_to_workout_input(user_workout: workout::Model) -> UserWorkoutInput {
    UserWorkoutInput {
        name: user_workout.name,
        end_time: user_workout.end_time,
        start_time: user_workout.start_time,
        template_id: user_workout.template_id,
        assets: user_workout.information.assets,
        create_workout_id: Some(user_workout.id),
        repeated_from: user_workout.repeated_from,
        comment: user_workout.information.comment,
        calories_burnt: user_workout.calories_burnt,
        duration: Some(user_workout.duration.into()),
        supersets: user_workout.information.supersets,
        exercises: user_workout
            .information
            .exercises
            .into_iter()
            .map(|e| UserExerciseInput {
                notes: e.notes,
                assets: e.assets,
                exercise_id: e.id,
                unit_system: e.unit_system,
                sets: e
                    .sets
                    .into_iter()
                    .map(|s| UserWorkoutSetRecord {
                        lot: s.lot,
                        rpe: s.rpe,
                        note: s.note,
                        rest_time: s.rest_time,
                        statistic: s.statistic,
                        confirmed_at: s.confirmed_at,
                        rest_timer_started_at: s.rest_timer_started_at,
                    })
                    .collect(),
            })
            .collect(),
        ..Default::default()
    }
}

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
        return Err(Error::new("This workout has no associated exercises"));
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
            return Err(Error::new("This exercise has no associated sets"));
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
        let mut to_update: user_to_entity::ActiveModel = asc.into();
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
        let mut association: user_to_entity::ActiveModel = association.into();
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
    let mut insert: workout::ActiveModel = model.into();
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
                    &(
                        format!("New workout created - {}", data.name),
                        UserNotificationContent::NewWorkoutCreated,
                    ),
                )
                .await?
            }
        }
    };
    expire_user_workouts_list_cache(user_id, ss).await?;
    Ok(data.id)
}
