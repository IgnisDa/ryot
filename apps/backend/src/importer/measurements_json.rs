use std::fs;

use async_graphql::Result;

use crate::{
    importer::{DeployJsonImportInput, ImportResult},
    models::CompleteExport,
};

pub async fn import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let measurements = serde_json::from_str::<CompleteExport>(&export)
        .unwrap()
        .measurements
        .unwrap();
    Ok(ImportResult {
        measurements,
        media: vec![],
        workouts: vec![],
        collections: vec![],
        failed_items: vec![],
    })
}
