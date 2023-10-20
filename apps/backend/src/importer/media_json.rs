use async_graphql::Result;

use crate::{
    importer::{DeployMediaJsonImportInput, ImportResult},
    models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem},
};

pub async fn import(input: DeployMediaJsonImportInput) -> Result<ImportResult> {
    let mut media = serde_json::from_str::<Vec<ImportOrExportMediaItem>>(&input.export).unwrap();
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
