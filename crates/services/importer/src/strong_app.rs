use std::{collections::HashMap, fs, sync::Arc};

use anyhow::{Result, bail};
use chrono::{Duration, NaiveDateTime};
use common_utils::ryot_log;
use csv::ReaderBuilder;
use database_models::exercise;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::ExerciseLot;
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use importer_models::{ImportFailStep, ImportFailedItem};
use indexmap::IndexMap;
use itertools::Itertools;
use media_models::DeployStrongAppImportInput;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

use super::utils;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
struct Entry {
    #[serde(alias = "Workout #")]
    workout_number: String,
    date: String,
    #[serde(alias = "Workout Name")]
    workout_name: String,
    #[serde(alias = "Duration (sec)", alias = "Duration")]
    workout_duration: String,
    #[serde(alias = "Exercise Name")]
    exercise_name: String,
    #[serde(alias = "Set Order")]
    set_order: String,
    #[serde(alias = "Weight (kg)")]
    weight: Option<Decimal>,
    reps: Option<Decimal>,
    #[serde(alias = "Distance (m)")]
    distance: Option<Decimal>,
    seconds: Option<Decimal>,
    notes: Option<String>,
    #[serde(alias = "Workout Notes")]
    workout_notes: Option<String>,
}

pub async fn import(
    input: DeployStrongAppImportInput,
    ss: &Arc<SupportingService>,
    user_id: &str,
) -> Result<ImportResult> {
    let mut completed = vec![];
    let mut failed = vec![];
    if let Some(csv_path) = input.data_export_path {
        import_exercises(user_id, csv_path, ss, &mut failed, &mut completed).await?;
    }
    Ok(ImportResult { failed, completed })
}

async fn import_exercises(
    user_id: &str,
    csv_path: String,
    ss: &Arc<SupportingService>,
    failed: &mut Vec<ImportFailedItem>,
    completed: &mut Vec<ImportCompletedItem>,
) -> Result<()> {
    let file_string = fs::read_to_string(&csv_path)?;
    // DEV: Delimiter is `;` on android and `,` on iOS, so we determine it by reading the first line
    let data = file_string.clone();
    let first_line = data.lines().next().unwrap();
    let delimiter = if first_line.contains(';') {
        b';'
    } else if first_line.contains(',') {
        b','
    } else {
        bail!("Could not determine delimiter");
    };

    let mut unique_exercises: HashMap<String, exercise::Model> = HashMap::new();
    let entries_reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .from_reader(file_string.as_bytes())
        .deserialize::<Entry>()
        .map(|r| r.unwrap())
        .collect_vec();

    let mut workouts_to_entries = IndexMap::new();
    for entry in entries_reader.clone() {
        workouts_to_entries
            .entry(entry.workout_number.clone())
            .or_insert(vec![])
            .push(entry);
    }

    let mut exercises_to_workouts = IndexMap::new();

    for (workout_number, entries) in workouts_to_entries {
        let mut exercises = IndexMap::new();
        for entry in entries {
            exercises
                .entry(entry.exercise_name.clone())
                .or_insert(vec![])
                .push(entry);
        }
        exercises_to_workouts.insert(workout_number, exercises);
    }

    for (_workout_number, workout) in exercises_to_workouts {
        let first_exercise = workout.first().unwrap().1.first().unwrap();
        let ndt = NaiveDateTime::parse_from_str(&first_exercise.date, "%Y-%m-%d %H:%M:%S")
            .expect("Failed to parse input string");
        let ndt = utils::get_date_time_with_offset(ndt, &ss.timezone);
        let workout_duration =
            Duration::try_seconds(first_exercise.workout_duration.parse().unwrap()).unwrap();
        let mut collected_exercises = vec![];
        for (exercise_name, exercises) in workout.clone() {
            let mut collected_sets = vec![];
            let mut notes = vec![];
            let valid_ex = exercises.iter().find(|e| e.set_order != "Note").unwrap();
            let exercise_lot = if valid_ex.seconds.is_some() && valid_ex.distance.is_some() {
                ExerciseLot::DistanceAndDuration
            } else if valid_ex.seconds.is_some() {
                ExerciseLot::Duration
            } else if valid_ex.reps.is_some() && valid_ex.weight.is_some() {
                ExerciseLot::RepsAndWeight
            } else if valid_ex.reps.is_some() {
                ExerciseLot::Reps
            } else {
                failed.push(ImportFailedItem {
                    step: ImportFailStep::InputTransformation,
                    identifier: format!(
                        "Workout #{}, Set #{}",
                        valid_ex.workout_number, valid_ex.set_order
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
                if let Some(note) = set.notes {
                    notes.push(note);
                }
                let weight = set.weight.map(|d| if d == dec!(0) { dec!(1) } else { d });
                let set_lot = match set.set_order.as_str() {
                    "W" => SetLot::WarmUp,
                    "F" => SetLot::Failure,
                    "D" => SetLot::Drop,
                    _ => SetLot::Normal,
                };
                collected_sets.push(UserWorkoutSetRecord {
                    lot: set_lot,
                    statistic: WorkoutSetStatistic {
                        weight,
                        reps: set.reps,
                        duration: set.seconds.and_then(|r| r.checked_div(dec!(60))),
                        distance: set.distance.and_then(|d| d.checked_div(dec!(1000))),
                        ..Default::default()
                    },
                    ..Default::default()
                });
            }
            collected_exercises.push(UserExerciseInput {
                notes,
                exercise_id,
                sets: collected_sets,
                ..Default::default()
            });
        }
        completed.push(ImportCompletedItem::Workout(UserWorkoutInput {
            start_time: ndt,
            exercises: collected_exercises,
            end_time: ndt + workout_duration,
            name: first_exercise.workout_name.clone(),
            comment: first_exercise.workout_notes.clone(),
            ..Default::default()
        }));
    }
    completed.extend(
        unique_exercises
            .values()
            .cloned()
            .map(ImportCompletedItem::Exercise),
    );
    Ok(())
}
