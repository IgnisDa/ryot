use std::fs;

use async_graphql::Result;
use chrono::{Duration, NaiveDateTime};
use csv::ReaderBuilder;
use dependent_models::{ImportOrExportWorkoutItem, ImportResult};
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use itertools::Itertools;
use media_models::DeployStrongAppImportInput;
use regex::Regex;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use super::utils;

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
struct Entry {
    date: String,
    weight: Option<Decimal>,
    reps: Option<Decimal>,
    distance: Option<Decimal>,
    seconds: Option<Decimal>,
    notes: Option<String>,
    #[serde(alias = "Set Order")]
    set_order: u8,
    #[serde(alias = "Workout Duration", alias = "Duration")]
    workout_duration: String,
    #[serde(alias = "Workout Name")]
    workout_name: String,
    #[serde(alias = "Workout Notes")]
    workout_notes: Option<String>,
    #[serde(alias = "Exercise Name")]
    exercise_name: String,
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
    let mut workouts = vec![];
    let mut entries_reader = ReaderBuilder::new()
        .delimiter(delimiter)
        .from_reader(file_string.as_bytes())
        .deserialize::<Entry>()
        .map(|r| r.unwrap())
        .collect_vec();
    // DEV: Without this, the last workout does not get appended
    entries_reader.push(Entry {
        date: "invalid".to_string(),
        set_order: 0,
        ..Default::default()
    });
    let mut exercises = vec![];
    let mut sets = vec![];
    let mut notes = vec![];
    for (entry, next_entry) in entries_reader.into_iter().tuple_windows() {
        let target_exercise = input
            .mapping
            .iter()
            .find(|m| m.source_name == entry.exercise_name.trim())
            .ok_or_else(|| format!("No mapping found for '{}'", entry.exercise_name))?;
        let mut weight = entry.weight.map(|d| if d == dec!(0) { dec!(1) } else { d });
        if let Some(mul) = target_exercise.multiplier {
            weight = weight.map(|w| w.saturating_mul(mul));
        }
        sets.push(UserWorkoutSetRecord {
            statistic: WorkoutSetStatistic {
                duration: entry.seconds.and_then(|r| r.checked_div(dec!(60))),
                distance: entry.distance,
                reps: entry.reps,
                weight,
                ..Default::default()
            },
            note: None,
            lot: SetLot::Normal,
            confirmed_at: None,
        });
        if let Some(n) = entry.notes {
            notes.push(n);
        }
        if next_entry.set_order <= entry.set_order {
            exercises.push(UserExerciseInput {
                exercise_id: target_exercise.target_name.clone(),
                sets,
                notes,
                assets: None,
                rest_time: None,
                superset_with: vec![],
            });
            sets = vec![];
            notes = vec![];
        }
        if next_entry.date != entry.date {
            let ndt = NaiveDateTime::parse_from_str(&entry.date, "%Y-%m-%d %H:%M:%S")
                .expect("Failed to parse input string");
            let ndt = utils::get_date_time_with_offset(ndt, timezone);
            let re = Regex::new(r"^(\d+h)?\s?(\d+m)?$").unwrap();
            let workout_duration = if let Some(captures) = re.captures(&entry.workout_duration) {
                let hours = captures.get(1).map_or(0, |m| {
                    m.as_str().trim_end_matches('h').parse::<i64>().unwrap_or(0)
                });
                let minutes = captures.get(2).map_or(0, |m| {
                    m.as_str().trim_end_matches('m').parse::<i64>().unwrap_or(0)
                });
                Duration::try_hours(hours).unwrap() + Duration::try_minutes(minutes).unwrap()
            } else {
                Duration::try_seconds(0).unwrap()
            };
            workouts.push(UserWorkoutInput {
                create_workout_id: None,
                template_id: None,
                repeated_from: None,
                default_rest_timer: None,
                name: entry.workout_name,
                comment: entry.workout_notes,
                start_time: ndt,
                end_time: ndt + workout_duration,
                exercises,
                assets: None,
                update_workout_id: None,
                update_workout_template_id: None,
            });
            exercises = vec![];
        }
    }
    Ok(ImportResult {
        workouts: workouts
            .into_iter()
            .map(|w| ImportOrExportWorkoutItem {
                details: w,
                collections: vec![],
            })
            .collect_vec(),
        ..Default::default()
    })
}
