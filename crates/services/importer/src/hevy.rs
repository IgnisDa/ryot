use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use chrono::NaiveDateTime;
use common_utils::ryot_log;
use csv::Reader;
use database_models::exercise;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::ExerciseLot;
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use importer_models::{ImportFailStep, ImportFailedItem};
use indexmap::IndexMap;
use itertools::Itertools;
use media_models::DeployGenericCsvImportInput;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

use super::utils;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct Entry {
    title: String,
    set_index: u8,
    rpe: Option<u8>,
    set_type: String,
    end_time: String,
    start_time: String,
    reps: Option<Decimal>,
    exercise_title: String,
    #[serde(alias = "weight_kg", alias = "weight_lbs")]
    weight: Option<Decimal>,
    #[serde(alias = "duration_seconds")]
    duration: Option<Decimal>,
    #[serde(alias = "distance_km", alias = "distance_miles")]
    distance: Option<Decimal>,
    description: Option<String>,
    exercise_notes: Option<String>,
}

pub async fn import(
    input: DeployGenericCsvImportInput,
    ss: &Arc<SupportingService>,
    user_id: &str,
) -> Result<ImportResult> {
    let mut completed = vec![];
    let mut failed = vec![];
    let mut unique_exercises: HashMap<String, exercise::Model> = HashMap::new();
    let entries_reader = Reader::from_path(&input.csv_path)?
        .deserialize::<Entry>()
        .map(|r| r.unwrap())
        .collect_vec();

    let mut workouts_to_entries = IndexMap::new();
    for entry in entries_reader.clone() {
        workouts_to_entries
            .entry((entry.start_time.clone(), entry.end_time.clone()))
            .or_insert(vec![])
            .push(entry);
    }

    let mut exercises_to_workouts = IndexMap::new();

    for (workout_number, entries) in workouts_to_entries {
        let mut exercises = IndexMap::new();
        for entry in entries {
            exercises
                .entry(entry.exercise_title.clone())
                .or_insert(vec![])
                .push(entry);
        }
        exercises_to_workouts.insert(workout_number, exercises);
    }

    for (workout_identifier, workout) in exercises_to_workouts {
        let first_exercise = workout.first().unwrap().1.first().unwrap();
        let mut collected_exercises = vec![];
        for (exercise_name, exercises) in workout.clone() {
            let mut collected_sets = vec![];
            let valid_ex = exercises.first().unwrap();
            let exercise_lot = if valid_ex.duration.is_some() && valid_ex.distance.is_some() {
                ExerciseLot::DistanceAndDuration
            } else if valid_ex.duration.is_some() {
                ExerciseLot::Duration
            } else if valid_ex.reps.is_some() && valid_ex.weight.is_some() {
                ExerciseLot::RepsAndWeight
            } else if valid_ex.reps.is_some() {
                ExerciseLot::Reps
            } else {
                failed.push(ImportFailedItem {
                    step: ImportFailStep::InputTransformation,
                    identifier: format!(
                        "Workout #{:#?}, Set #{}",
                        workout_identifier, valid_ex.set_index
                    ),
                    error: Some(format!(
                        "Could not determine exercise lot: {}",
                        serde_json::to_string(&valid_ex).unwrap()
                    )),
                    ..Default::default()
                });
                continue;
            };
            let exercise_id = utils::associate_with_existing_or_new_exercise(
                user_id,
                &exercise_name,
                exercise_lot,
                ss,
                &mut unique_exercises,
            )
            .await?;
            ryot_log!(debug, "Importing exercise with id = {}", exercise_id);
            for set in exercises {
                let weight = set.weight.map(|d| if d == dec!(0) { dec!(1) } else { d });
                let set_lot = match set.set_type.as_str() {
                    "warmup" => SetLot::WarmUp,
                    "failure" => SetLot::Failure,
                    "dropset" => SetLot::Drop,
                    _ => SetLot::Normal,
                };
                collected_sets.push(UserWorkoutSetRecord {
                    lot: set_lot,
                    rpe: set.rpe,
                    statistic: WorkoutSetStatistic {
                        weight,
                        reps: set.reps,
                        duration: set.duration.and_then(|r| r.checked_div(dec!(60))),
                        distance: set.distance.and_then(|d| d.checked_div(dec!(1000))),
                        ..Default::default()
                    },
                    ..Default::default()
                });
            }
            collected_exercises.push(UserExerciseInput {
                exercise_id,
                sets: collected_sets,
                notes: first_exercise
                    .exercise_notes
                    .clone()
                    .map(|n| vec![n])
                    .unwrap_or_default(),
                ..Default::default()
            });
        }
        let start_time = parse_date_string(&first_exercise.start_time);
        let end_time = parse_date_string(&first_exercise.end_time);
        completed.push(ImportCompletedItem::Workout(UserWorkoutInput {
            exercises: collected_exercises,
            name: first_exercise.title.clone(),
            comment: first_exercise.description.clone(),
            end_time: utils::get_date_time_with_offset(end_time, &ss.timezone),
            start_time: utils::get_date_time_with_offset(start_time, &ss.timezone),
            ..Default::default()
        }));
    }
    completed.extend(
        unique_exercises
            .values()
            .cloned()
            .map(ImportCompletedItem::Exercise),
    );
    Ok(ImportResult { failed, completed })
}

fn parse_date_string(input: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(input, "%d %b %Y, %H:%M").unwrap()
}
