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

use crate::utils;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
struct Entry {
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
    let first_line = file_string.lines().next().unwrap();
    // DEV: Delimiter is `;` on android and `,` on iOS, so we determine it by reading the first line
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
        if entry.set_order != "Rest Timer" && entry.set_order != "Note" {
            workouts_to_entries
                .entry(entry.date.clone())
                .or_insert(vec![])
                .push(entry);
        }
    }

    let mut exercises_to_workouts = IndexMap::new();

    for (workout_date, entries) in workouts_to_entries {
        let mut exercises = IndexMap::new();
        for entry in entries {
            exercises
                .entry(entry.exercise_name.clone())
                .or_insert(vec![])
                .push(entry);
        }
        exercises_to_workouts.insert(workout_date, exercises);
    }

    for (_workout_date, workout) in exercises_to_workouts {
        let first_exercise = workout.first().unwrap().1.first().unwrap();
        let ndt = NaiveDateTime::parse_from_str(&first_exercise.date, "%Y-%m-%d %H:%M:%S")
            .expect("Failed to parse input string");
        let ndt = utils::get_date_time_with_offset(ndt, &ss.timezone);
        let workout_duration_seconds = parse_workout_duration(&first_exercise.workout_duration)?;
        let workout_duration = Duration::try_seconds(workout_duration_seconds).unwrap();
        let mut collected_exercises = vec![];
        for (exercise_name, exercises) in workout.clone() {
            let mut collected_sets = vec![];
            let mut notes = vec![];

            let exercise_lot = match determine_exercise_lot(&exercises) {
                Some(lot) => lot,
                None => {
                    failed.push(ImportFailedItem {
                        step: ImportFailStep::InputTransformation,
                        identifier: format!("Exercise: {}", exercise_name),
                        error: Some(format!(
                            "Could not determine exercise lot from {} sets",
                            exercises.len()
                        )),
                        ..Default::default()
                    });
                    continue;
                }
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

fn has_meaningful_value(value: &Option<Decimal>) -> bool {
    value.is_some_and(|v| v > dec!(0))
}

fn determine_exercise_lot(exercises: &[Entry]) -> Option<ExerciseLot> {
    let valid_sets: Vec<_> = exercises
        .iter()
        .filter(|e| e.set_order != "Note" && e.set_order != "Rest Timer")
        .collect();

    if valid_sets.is_empty() {
        return None;
    }

    let has_distance_and_duration = valid_sets
        .iter()
        .any(|e| has_meaningful_value(&e.seconds) && has_meaningful_value(&e.distance));
    let has_duration_only = valid_sets.iter().any(|e| has_meaningful_value(&e.seconds));
    let has_reps_and_weight = valid_sets
        .iter()
        .any(|e| has_meaningful_value(&e.reps) && has_meaningful_value(&e.weight));
    let has_reps_only = valid_sets.iter().any(|e| has_meaningful_value(&e.reps));

    if has_distance_and_duration {
        Some(ExerciseLot::DistanceAndDuration)
    } else if has_duration_only {
        Some(ExerciseLot::Duration)
    } else if has_reps_and_weight {
        Some(ExerciseLot::RepsAndWeight)
    } else if has_reps_only {
        Some(ExerciseLot::Reps)
    } else {
        None
    }
}

fn parse_workout_duration(duration_str: &str) -> Result<i64> {
    if duration_str.chars().all(|c| c.is_ascii_digit()) {
        return Ok(duration_str.parse()?);
    }
    let mut total_seconds = 0i64;
    let duration_str = duration_str.to_lowercase();

    if let Some(h_pos) = duration_str.find('h') {
        let hours: i64 = duration_str[..h_pos].parse()?;
        total_seconds += hours * 3600;
    }

    if let Some(m_pos) = duration_str.find('m') {
        let start = if duration_str.contains('h') {
            duration_str.find('h').unwrap() + 1
        } else {
            0
        };
        let minutes_str = duration_str[start..m_pos].trim();
        if !minutes_str.is_empty() {
            let minutes: i64 = minutes_str.parse()?;
            total_seconds += minutes * 60;
        }
    }

    if let Some(s_pos) = duration_str.find('s') {
        let start = if duration_str.contains('m') {
            duration_str.find('m').unwrap() + 1
        } else if duration_str.contains('h') {
            duration_str.find('h').unwrap() + 1
        } else {
            0
        };
        let seconds_str = duration_str[start..s_pos].trim();
        if !seconds_str.is_empty() {
            let seconds: i64 = seconds_str.parse()?;
            total_seconds += seconds;
        }
    }

    Ok(total_seconds)
}
