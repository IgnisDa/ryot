use std::{fs, sync::Arc};

use async_graphql::Result;
use chrono::{DateTime, Duration, NaiveDateTime, Offset, TimeZone, Utc};
use csv::ReaderBuilder;
use itertools::Itertools;
use regex::Regex;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::models::fitness::{
    EntityAssets, SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord,
    WorkoutSetStatistic,
};

use super::{DeployStrongAppImportInput, ImportResult};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "PascalCase")]
struct Entry {
    date: String,
    notes: Option<String>,
    weight: Option<Decimal>,
    reps: Option<usize>,
    distance: Option<Decimal>,
    seconds: Option<Decimal>,
    #[serde(alias = "Set Order")]
    set_order: u8,
    #[serde(alias = "Workout Duration")]
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
    timezone: Arc<chrono_tz::Tz>,
) -> Result<ImportResult> {
    let offset = timezone
        .offset_from_utc_datetime(&Utc::now().naive_utc())
        .fix()
        .local_minus_utc();
    let offset = Duration::seconds(offset.into());
    let file_string = fs::read_to_string(&input.export_path)?;
    let mut workouts = vec![];
    let mut entries_reader = ReaderBuilder::new()
        .delimiter(b';')
        .from_reader(file_string.as_bytes())
        .deserialize::<Entry>()
        .map(|r| r.unwrap())
        .collect_vec();
    // DEV: without this, the last workout does not get appended
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
                rest_time: None,
                assets: EntityAssets::default(),
                superset_with: vec![],
            });
            sets = vec![];
            notes = vec![];
        }
        if next_entry.date != entry.date {
            let ndt = NaiveDateTime::parse_from_str(&entry.date, "%Y-%m-%d %H:%M:%S")
                .expect("Failed to parse input string");
            let ndt = DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc) - offset;
            let re = Regex::new(r"^(\d+h)?\s?(\d+m)?$").unwrap();
            let workout_duration = if let Some(captures) = re.captures(&entry.workout_duration) {
                let hours = captures.get(1).map_or(0, |m| {
                    m.as_str().trim_end_matches('h').parse::<i64>().unwrap_or(0)
                });
                let minutes = captures.get(2).map_or(0, |m| {
                    m.as_str().trim_end_matches('m').parse::<i64>().unwrap_or(0)
                });
                Duration::hours(hours) + Duration::minutes(minutes)
            } else {
                Duration::seconds(0)
            };
            workouts.push(UserWorkoutInput {
                id: None,
                repeated_from: None,
                name: entry.workout_name,
                comment: entry.workout_notes,
                start_time: ndt,
                end_time: ndt + workout_duration,
                exercises,
                assets: EntityAssets::default(),
            });
            exercises = vec![];
        }
    }
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
        workouts,
    })
}
