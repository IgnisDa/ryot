use async_graphql::Result;
use dependent_models::ImportResult;
use media_models::DeployUrlAndKeyImportInput;

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
    dbg!(input);
    todo!()
}
