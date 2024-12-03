use std::{collections::HashMap, fs, sync::Arc};

use async_graphql::Result;
use chrono::{Duration, NaiveDateTime};
use common_utils::ryot_log;
use csv::ReaderBuilder;
use database_models::{exercise, prelude::Exercise};
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::ExerciseLot;
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use importer_models::{ImportFailStep, ImportFailedItem};
use itertools::Itertools;
use media_models::DeployStrongAppImportInput;
use nanoid::nanoid;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
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
) -> Result<ImportResult> {
    let mut completed = vec![];
    let mut failed = vec![];
    if let Some(csv_path) = input.data_export_path {
        import_exercises(csv_path, ss, &mut failed, &mut completed).await?;
    }
    Ok(ImportResult {
        failed,
        completed,
        ..Default::default()
    })
}

async fn import_exercises(
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
        return Err("Could not determine delimiter".into());
    };
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
    let mut unique_exercises: HashMap<String, exercise::Model> = HashMap::new();
    let mut exercises = vec![];
    let mut sets = vec![];
    let mut notes = vec![];
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
        let existing_exercise = Exercise::find()
            .filter(exercise::Column::Id.eq(&entry.exercise_name))
            .filter(exercise::Column::Lot.eq(exercise_lot))
            .one(&ss.db)
            .await?;
        let exercise_id = if let Some(db_ex) = existing_exercise {
            db_ex.id
        } else if let Some(mem_ex) = unique_exercises.get(&entry.exercise_name) {
            mem_ex.id.clone()
        } else {
            let id = format!("{} [{}]", entry.exercise_name, nanoid!(5));
            unique_exercises.insert(
                entry.exercise_name.clone(),
                exercise::Model {
                    id: id.clone(),
                    lot: exercise_lot,
                    ..Default::default()
                },
            );
            id
        };
        ryot_log!(debug, "Importing exercise with id = {}", exercise_id);
        let weight = entry.weight.map(|d| if d == dec!(0) { dec!(1) } else { d });
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
                exercise_id,
                assets: None,
            });
            sets = vec![];
            notes = vec![];
        }
        if next_entry.date != entry.date {
            let ndt = NaiveDateTime::parse_from_str(&entry.date, "%Y-%m-%d %H:%M:%S")
                .expect("Failed to parse input string");
            let ndt = utils::get_date_time_with_offset(ndt, &ss.timezone);
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
    completed.extend(
        unique_exercises
            .values()
            .cloned()
            .map(ImportCompletedItem::Exercise),
    );
    Ok(())
}
