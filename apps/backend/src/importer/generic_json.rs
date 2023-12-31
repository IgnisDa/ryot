use std::fs;

use async_graphql::Result;

use crate::{
    importer::{DeployGenericJsonImportInput, ImportResult},
    models::{media::ImportOrExportItemIdentifier, CompleteExport},
};

pub async fn import(input: DeployGenericJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    let mut media = serde_json::from_str::<CompleteExport>(&export)
        .unwrap()
        .media
        .unwrap();
    media.iter_mut().for_each(|m| {
        m.internal_identifier = Some(ImportOrExportItemIdentifier::NeedsDetails(
            m.identifier.clone(),
        ))
    });
    Ok(ImportResult {
        collections: vec![],
        media,
        failed_items: vec![],
        workouts: vec![],
    })
}
