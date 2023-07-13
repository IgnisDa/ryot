use async_graphql::Result;

use crate::importer::{DeployMovaryImportInput, ImportResult};

pub async fn import(input: DeployMovaryImportInput) -> Result<ImportResult> {
    let mut media_items = vec![];
    let mut all_collections = vec![];
    let mut failed_items = vec![];
    todo!();
    Ok(ImportResult {
        collections: all_collections,
        media: media_items,
        failed_items,
    })
}
