use std::fs;

use async_graphql::Result;

use crate::{
    importer::{DeployJsonImportInput, ImportResult},
    models::{media::ImportOrExportItemIdentifier, CompleteExport},
};

pub async fn import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let mut media = serde_json::from_str::<CompleteExport>(&export)
        .unwrap()
        .media
        .unwrap();
    media.iter_mut().for_each(|m| {
        m.internal_identifier = Some(ImportOrExportItemIdentifier::NeedsDetails {
            identifier: m.identifier.clone(),
            title: m.source_id.clone(),
        })
    });
    Ok(ImportResult {
        media,
        collections: vec![],
        failed_items: vec![],
        workouts: vec![],
        measurements: vec![],
    })
}
