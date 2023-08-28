use async_graphql::Result;

use crate::importer::{DeployMalImportInput, ImportResult};

pub async fn import(input: DeployMalImportInput) -> Result<ImportResult> {
    dbg!(&input);
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
    })
}
