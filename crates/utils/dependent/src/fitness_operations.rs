use std::{collections::HashMap, sync::Arc};

use async_graphql::Result;
use common_models::{ChangeCollectionToEntityInput, DefaultCollection};
use common_utils::ryot_log;
use database_models::{exercise, prelude::*, user, user_measurement, workout};
use database_utils::user_by_id;
use enum_models::{EntityLot, ExerciseLot, ExerciseSource, WorkoutSetPersonalBest};
use fitness_models::{
    ProcessedExercise, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord,
    WorkoutEquipmentFocusedSummary, WorkoutFocusedSummary, WorkoutForceFocusedSummary,
    WorkoutLevelFocusedSummary, WorkoutLotFocusedSummary, WorkoutMuscleFocusedSummary,
    WorkoutSetRecord, WorkoutSetStatistic,
};
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, prelude::DateTimeUtc,
};
use std::cmp::Reverse;
use supporting_service::SupportingService;
use user_models::UserStatisticsMeasurement;

use crate::{
    collection_operations::add_entity_to_collection,
    utility_operations::expire_user_measurements_list_cache,
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
) -> WorkoutFocusedSummary {
    let db_exercises = Exercise::find()
        .filter(exercise::Column::Id.is_in(exercises.iter().map(|e| e.id.clone())))
        .all(&ss.db)
        .await
        .unwrap();
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
    WorkoutFocusedSummary {
        lots,
        levels,
        forces,
        muscles,
        equipments,
    }
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
    add_entity_to_collection(
        &user_id.clone(),
        ChangeCollectionToEntityInput {
            entity_id: exercise.id.clone(),
            entity_lot: EntityLot::Exercise,
            creator_user_id: user_id.to_owned(),
            collection_name: DefaultCollection::Custom.to_string(),
            ..Default::default()
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
