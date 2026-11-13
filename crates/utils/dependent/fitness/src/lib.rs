use std::{cmp::Reverse, collections::HashMap, sync::Arc};

use anyhow::{Result, anyhow, bail};
use common_utils::get_first_max_index_by;
use database_models::{
    exercise,
    prelude::{Exercise, UserMeasurement, WorkoutTemplate},
    user_measurement, workout, workout_template,
};
use dependent_utility_utils::{
    expire_user_measurements_list_cache, expire_user_workout_template_details_cache,
    expire_user_workout_templates_list_cache,
};
use enum_models::{ExerciseLot, WorkoutSetPersonalBest};
use fitness_models::{
    ProcessedExercise, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord,
    WorkoutEquipmentFocusedSummary, WorkoutFocusedSummary, WorkoutForceFocusedSummary,
    WorkoutInformation, WorkoutLevelFocusedSummary, WorkoutLotFocusedSummary,
    WorkoutMuscleFocusedSummary, WorkoutSetRecord, WorkoutSetStatistic, WorkoutSummary,
    WorkoutSummaryExercise,
};
use futures::try_join;
use itertools::Itertools;
use nanoid::nanoid;
use rust_decimal::{Decimal, dec};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter, prelude::DateTimeUtc, sea_query::OnConflict,
};
use supporting_service::SupportingService;

mod custom_exercises;
mod workouts;

pub use custom_exercises::{create_custom_exercise, generate_exercise_id, update_custom_exercise};
pub use workouts::create_or_update_user_workout;

pub async fn create_or_update_user_measurement(
    user_id: &String,
    mut input: user_measurement::Model,
    ss: &Arc<SupportingService>,
) -> Result<DateTimeUtc> {
    let existing = UserMeasurement::find()
        .filter(user_measurement::Column::UserId.eq(user_id))
        .filter(user_measurement::Column::Timestamp.eq(input.timestamp))
        .one(&ss.db)
        .await?;

    if let Some(existing_measurement) = existing {
        existing_measurement.delete(&ss.db).await?;
    }

    input.user_id = user_id.to_owned();

    let um = input.into_active_model();
    let um = um.insert(&ss.db).await?;
    expire_user_measurements_list_cache(user_id, ss).await?;
    Ok(um.timestamp)
}

pub fn get_best_set_index(records: &[WorkoutSetRecord]) -> Option<usize> {
    get_first_max_index_by(records, |a, b| {
        let score_a = a.statistic.duration.unwrap_or(dec!(0))
            + a.statistic.distance.unwrap_or(dec!(0))
            + a.statistic.reps.unwrap_or(dec!(0))
            + a.statistic.weight.unwrap_or(dec!(0));
        let score_b = b.statistic.duration.unwrap_or(dec!(0))
            + b.statistic.distance.unwrap_or(dec!(0))
            + b.statistic.reps.unwrap_or(dec!(0))
            + b.statistic.weight.unwrap_or(dec!(0));
        score_a.cmp(&score_b)
    })
}

pub fn get_index_of_highest_pb(
    records: &[WorkoutSetRecord],
    pb_type: &WorkoutSetPersonalBest,
) -> Option<usize> {
    get_first_max_index_by(records, |a, b| {
        let pb_a = get_personal_best(a, pb_type).unwrap_or(dec!(0));
        let pb_b = get_personal_best(b, pb_type).unwrap_or(dec!(0));
        pb_a.cmp(&pb_b)
    })
}

pub fn calculate_one_rm(value: &WorkoutSetRecord) -> Option<Decimal> {
    let weight = value.statistic.weight?;
    let reps = value.statistic.reps?;
    let val = match reps < dec!(10) {
        true => (weight * dec!(36.0)).checked_div(dec!(37.0) - reps), // Brzycki
        false => weight.checked_mul((dec!(1).checked_add(reps.checked_div(dec!(30))?))?), // Epley
    };
    val.filter(|v| v >= &dec!(0))
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
            anyhow!(format!(
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

pub fn db_workout_template_to_workout_input(
    workout_template: workout_template::Model,
) -> UserWorkoutInput {
    UserWorkoutInput {
        name: workout_template.name,
        assets: workout_template.information.assets,
        comment: workout_template.information.comment,
        supersets: workout_template.information.supersets,
        update_workout_template_id: Some(workout_template.id),
        exercises: workout_template
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

pub async fn upsert_workout_template(
    user_id: &String,
    input: UserWorkoutInput,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    if let Some(id) = &input.update_workout_template_id {
        let template = WorkoutTemplate::find_by_id(id)
            .filter(workout_template::Column::UserId.eq(user_id))
            .one(&ss.db)
            .await?;
        if template.is_none() {
            bail!("Workout template with the given ID could not be found for this user.");
        }
    }
    let mut summary = WorkoutSummary::default();
    let mut information = WorkoutInformation {
        assets: input.assets,
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
            assets: exercise.assets,
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
                    confirmed_at: s.confirmed_at,
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
    let template_id = match &input.update_workout_template_id {
        Some(id) => id.clone(),
        None => format!("wktpl_{}", nanoid!(12)),
    };
    let template = workout_template::ActiveModel {
        id: ActiveValue::Set(template_id),
        name: ActiveValue::Set(input.name),
        summary: ActiveValue::Set(summary),
        user_id: ActiveValue::Set(user_id.clone()),
        information: ActiveValue::Set(information),
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
    try_join!(
        expire_user_workout_templates_list_cache(user_id, ss),
        expire_user_workout_template_details_cache(user_id, &template.id, ss)
    )?;
    Ok(template.id)
}
