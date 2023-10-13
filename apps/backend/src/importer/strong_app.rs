use std::fs::read_to_string;

use async_graphql::Result;
use csv::ReaderBuilder;
use itertools::Itertools;
use serde::{Deserialize, Serialize};

use super::{DeployStrongAppImportInput, ImportResult};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Entry {
    date: String,
    notes: Option<String>,
    weight: Option<f32>,
    reps: Option<f32>,
    distance: Option<f32>,
    seconds: Option<f32>,
    #[serde(alias = "Set Order")]
    set_order: Option<u8>,
    #[serde(alias = "Workout Duration")]
    workout_duration: String,
    #[serde(alias = "Workout Name")]
    workout_name: String,
    #[serde(alias = "Workout Notes")]
    workout_notes: Option<String>,
    #[serde(alias = "Exercise Name")]
    exercise_name: String,
}

pub async fn import(input: DeployStrongAppImportInput) -> Result<ImportResult> {
    let file_string = read_to_string(&input.export_path)?;
    let entries_reader = ReaderBuilder::new()
        .delimiter(b';')
        .from_reader(file_string.as_bytes())
        .deserialize::<Entry>()
        .collect_vec();
    for (idx, result) in entries_reader.into_iter().enumerate() {
        dbg!(&result);
    }
    todo!()
}
