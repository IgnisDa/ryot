use std::fs;

use async_graphql::Result;
use dependent_models::ImportResult;
use media_models::DeployJsonImportInput;

pub async fn import(input: DeployJsonImportInput) -> Result<ImportResult> {
    let export = fs::read_to_string(input.export)?;
    Ok(ImportResult {
        ..Default::default()
    })
}
