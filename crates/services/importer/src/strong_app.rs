use std::{collections::HashSet, fs};

use async_graphql::Result;
use chrono::{Duration, NaiveDateTime};
use csv::ReaderBuilder;
use database_models::exercise;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::ExerciseLot;
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use importer_models::{ImportFailStep, ImportFailedItem};
use itertools::Itertools;
use media_models::DeployStrongAppImportInput;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

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
    timezone: &chrono_tz::Tz,
) -> Result<ImportResult> {
    let file_string = fs::read_to_string(&input.export_path)?;
    // DEV: Delimiter is `;` on android and `,` on iOS, so we determine it by reading the first line
    let data = file_string.clone();
    let first_line = data.lines().next().unwrap();
    let delimiter = if first_line.contains(';') {
        b';'
    } else if first_line.contains(',') {
        b','
    } else {
        return Err("Could not determine delimiter".into());
    };
    let mut completed = vec![];
    let mut failed = vec![];
    let mut entries_reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .from_reader(file_string.as_bytes())
        .deserialize::<Entry>()
        .map(|r| r.unwrap())
        .collect_vec();
    // DEV: Without this, the last workout does not get appended
    entries_reader.push(Entry {
        set_order: "0".to_string(),
        date: "invalid".to_string(),
        ..Default::default()
    });
    let mut exercises = vec![];
    let mut sets = vec![];
    let mut notes = vec![];
    let mut unique_exercises = HashSet::new();
    for (entry, next_entry) in entries_reader.into_iter().tuple_windows() {
        if entry.set_order == "Note" {
            continue;
        }
        let exercise_lot = if entry.seconds.is_some() && entry.distance.is_some() {
            ExerciseLot::DistanceAndDuration
        } else if entry.seconds.is_some() {
            ExerciseLot::Duration
        } else if entry.reps.is_some() && entry.weight.is_some() {
            ExerciseLot::RepsAndWeight
        } else if entry.reps.is_some() {
            ExerciseLot::Reps
        } else {
            failed.push(ImportFailedItem {
                lot: None,
                identifier: format!(
                    "Workout #{}, Set #{}",
                    entry.workout_number, entry.set_order
                ),
                step: ImportFailStep::InputTransformation,
                error: Some(format!(
                    "Could not determine exercise lot: {}",
                    serde_json::to_string(&entry).unwrap()
                )),
            });
            continue;
        };
        unique_exercises.insert(exercise::Model {
            lot: exercise_lot,
            id: entry.exercise_name.clone(),
            ..Default::default()
        });
        let target_exercise = input
            .mapping
            .iter()
            .find(|m| m.source_name == entry.exercise_name.trim())
            .ok_or_else(|| format!("No mapping found for {:#?}", entry.exercise_name))?;
        let mut weight = entry.weight.map(|d| if d == dec!(0) { dec!(1) } else { d });
        if let Some(mul) = target_exercise.multiplier {
            weight = weight.map(|w| w.saturating_mul(mul));
        }
        sets.push(UserWorkoutSetRecord {
            statistic: WorkoutSetStatistic {
                weight,
                reps: entry.reps,
                duration: entry.seconds.and_then(|r| r.checked_div(dec!(60))),
                distance: entry.distance.and_then(|d| d.checked_div(dec!(1000))),
                ..Default::default()
            },
            note: None,
            rest_time: None,
            confirmed_at: None,
            lot: SetLot::Normal,
        });
        if let Some(n) = entry.notes {
            notes.push(n);
        }
        if next_entry.set_order <= entry.set_order {
            exercises.push(UserExerciseInput {
                sets,
                notes,
                assets: None,
                exercise_id: target_exercise.target_name.clone(),
            });
            sets = vec![];
            notes = vec![];
        }
        if next_entry.date != entry.date {
            let ndt = NaiveDateTime::parse_from_str(&entry.date, "%Y-%m-%d %H:%M:%S")
                .expect("Failed to parse input string");
            let ndt = utils::get_date_time_with_offset(ndt, timezone);
            let workout_duration =
                Duration::try_seconds(entry.workout_duration.parse().unwrap()).unwrap();
            completed.push(ImportCompletedItem::Workout(UserWorkoutInput {
                exercises,
                assets: None,
                start_time: ndt,
                supersets: vec![],
                template_id: None,
                repeated_from: None,
                create_workout_id: None,
                update_workout_id: None,
                name: entry.workout_name,
                comment: entry.workout_notes,
                end_time: ndt + workout_duration,
                update_workout_template_id: None,
            }));
            exercises = vec![];
        }
    }
    Ok(ImportResult {
        failed,
        completed,
        ..Default::default()
    })
}
