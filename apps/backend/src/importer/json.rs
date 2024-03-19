use std::{fs, sync::Arc};

use async_graphql::Result;

use crate::{
    entities::{user_measurement, workout},
    fitness::resolver::ExerciseService,
    importer::{DeployJsonImportInput, ImportResult},
    models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem},
};

pub async fn media_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let mut media = serde_json::from_str::<Vec<ImportOrExportMediaItem>>(&export).unwrap();
    media.iter_mut().for_each(|m| {
        m.internal_identifier = Some(ImportOrExportItemIdentifier::NeedsDetails {
            identifier: m.identifier.clone(),
            title: m.source_id.clone(),
        })
    });
    Ok(ImportResult {
        media,
        people: vec![],
        workouts: vec![],
        collections: vec![],
        failed_items: vec![],
        measurements: vec![],
    })
}

pub async fn measurements_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let measurements = serde_json::from_str::<Vec<user_measurement::Model>>(&export).unwrap();
    Ok(ImportResult {
        measurements,
        people: vec![],
        media: vec![],
        workouts: vec![],
        collections: vec![],
        failed_items: vec![],
    })
}

pub async fn workouts_import(
    input: DeployJsonImportInput,
    exercises_service: &Arc<ExerciseService>,
) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let db_workouts = serde_json::from_str::<Vec<workout::Model>>(&export).unwrap();
    let workouts = db_workouts
        .into_iter()
        .map(|w| exercises_service.db_workout_to_workout_input(w))
        .collect();
    Ok(ImportResult {
        workouts,
        people: vec![],
        media: vec![],
        collections: vec![],
        measurements: vec![],
        failed_items: vec![],
    })
}
