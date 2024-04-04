use std::{fs, sync::Arc};

use async_graphql::Result;
use database::ImportSource;

use crate::{
    entities::{user_measurement, workout},
    fitness::resolver::ExerciseService,
    importer::{DeployJsonImportInput, ImportResult},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaGroupItem, ImportOrExportMediaItem,
        ImportOrExportPersonItem,
    },
};

pub async fn media_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let mut media = serde_json::from_str::<Vec<ImportOrExportMediaItem>>(&export).unwrap();
    media.iter_mut().for_each(|m| {
        m.internal_identifier = Some(ImportOrExportItemIdentifier::NeedsDetails {
            identifier: m.identifier.clone(),
            title: m.source_id.clone(),
        });
        m.seen_history.iter_mut().for_each(|s| {
            s.provider_watched_on = Some(ImportSource::MediaJson.to_string());
        });
    });
    Ok(ImportResult {
        media,
        ..Default::default()
    })
}

pub async fn measurements_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let measurements = serde_json::from_str::<Vec<user_measurement::Model>>(&export).unwrap();
    Ok(ImportResult {
        measurements,
        ..Default::default()
    })
}

pub async fn people_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let people = serde_json::from_str::<Vec<ImportOrExportPersonItem>>(&export).unwrap();
    Ok(ImportResult {
        people,
        ..Default::default()
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
        ..Default::default()
    })
}

pub async fn media_groups_import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let media_groups = serde_json::from_str::<Vec<ImportOrExportMediaGroupItem>>(&export).unwrap();
    Ok(ImportResult {
        media_groups,
        ..Default::default()
    })
}
