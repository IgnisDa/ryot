use async_graphql::Result;

use super::{DeployStrongAppImportInput, ImportResult};

pub async fn import(input: DeployStrongAppImportInput) -> Result<ImportResult> {
    dbg!(input);
    todo!()
}
