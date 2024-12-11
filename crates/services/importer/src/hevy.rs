use std::{collections::HashMap, fs, sync::Arc};

use async_graphql::Result;
use chrono::NaiveDateTime;
use common_utils::ryot_log;
use csv::ReaderBuilder;
use database_models::{exercise, prelude::Exercise};
use dependent_models::{ImportCompletedItem, ImportResult};
use dependent_utils::generate_exercise_id;
use enums::{ExerciseLot, ExerciseSource};
use fitness_models::{
    SetLot, UserExerciseInput, UserWorkoutInput, UserWorkoutSetRecord, WorkoutSetStatistic,
};
use importer_models::{ImportFailStep, ImportFailedItem};
use indexmap::IndexMap;
use itertools::Itertools;
use media_models::DeployGenericCsvImportInput;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

use crate::utils;

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
    #[serde(alias = "weight_kg")]
    weight: Option<Decimal>,
    #[serde(alias = "duration_seconds")]
    duration: Option<Decimal>,
    #[serde(alias = "distance_km")]
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
    let file_string = fs::read_to_string(&input.csv_path)?;
    let mut unique_exercises: HashMap<String, exercise::Model> = HashMap::new();
    let entries_reader = ReaderBuilder::new()
        .double_quote(true)
        .from_reader(file_string.as_bytes())
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
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: format!(
                        "Workout #{:#?}, Set #{}",
                        workout_identifier, valid_ex.set_index
                    ),
                    error: Some(format!(
                        "Could not determine exercise lot: {}",
                        serde_json::to_string(&valid_ex).unwrap()
                    )),
                });
                continue;
            };
            let existing_exercise = Exercise::find()
                .filter(exercise::Column::Lot.eq(exercise_lot))
                .filter(exercise::Column::Name.eq(&exercise_name))
                .one(&ss.db)
                .await?;
            let generated_id = generate_exercise_id(&exercise_name, exercise_lot, user_id);
            let exercise_id = match existing_exercise {
                Some(db_ex)
                    if db_ex.source == ExerciseSource::Github || db_ex.id == generated_id =>
                {
                    db_ex.id
                }
                _ => match unique_exercises.get(&exercise_name) {
                    Some(mem_ex) => mem_ex.id.clone(),
                    None => {
                        unique_exercises.insert(
                            exercise_name.clone(),
                            exercise::Model {
                                lot: exercise_lot,
                                name: exercise_name,
                                id: generated_id.clone(),
                                ..Default::default()
                            },
                        );
                        generated_id
                    }
                },
            };
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
                    statistic: WorkoutSetStatistic {
                        weight,
                        reps: set.reps,
                        duration: set.duration.and_then(|r| r.checked_div(dec!(60))),
                        distance: set.distance.and_then(|d| d.checked_div(dec!(1000))),
                        ..Default::default()
                    },
                    rpe: None,
                    note: None,
                    lot: set_lot,
                    rest_time: None,
                    confirmed_at: None,
                });
            }
            collected_exercises.push(UserExerciseInput {
                exercise_id,
                assets: None,
                sets: collected_sets,
                notes: first_exercise
                    .exercise_notes
                    .clone()
                    .map(|n| vec![n])
                    .unwrap_or_default(),
            });
        }
        let start_time =
            NaiveDateTime::parse_from_str(&first_exercise.start_time, "%d %b %Y, %H:%M").unwrap();
        let end_time =
            NaiveDateTime::parse_from_str(&first_exercise.end_time, "%d %b %Y, %H:%M").unwrap();
        completed.push(ImportCompletedItem::Workout(UserWorkoutInput {
            assets: None,
            supersets: vec![],
            template_id: None,
            repeated_from: None,
            create_workout_id: None,
            update_workout_id: None,
            exercises: collected_exercises,
            update_workout_template_id: None,
            name: first_exercise.title.clone(),
            comment: first_exercise.description.clone(),
            end_time: utils::get_date_time_with_offset(end_time, &ss.timezone),
            start_time: utils::get_date_time_with_offset(start_time, &ss.timezone),
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
