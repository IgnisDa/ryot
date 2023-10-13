use async_graphql::Result;

use crate::importer::{DeployMediaJsonImportInput, ImportResult};

pub async fn import(input: DeployMediaJsonImportInput) -> Result<ImportResult> {
    let media = serde_json::from_str(&input.export).unwrap();
    Ok(ImportResult {
        collections: vec![],
        media,
        failed_items: vec![],
        workouts: vec![],
    })
}
