use async_graphql::Result;

use crate::importer::ImportResult;

use super::DeployAudiobookshelfImportInput;

pub async fn import(input: DeployAudiobookshelfImportInput) -> Result<ImportResult> {
    dbg!(&input);
    Ok(ImportResult {
        collections: vec![],
        media: vec![],
        failed_items: vec![],
        workouts: vec![],
    })
}
