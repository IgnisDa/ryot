use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use database_models::import_report;
use importer_service::ImporterService;
use media_models::DeployImportJobInput;
use traits::AuthProvider;

#[derive(Default)]
pub struct ImporterQuery;

impl AuthProvider for ImporterQuery {}

#[Object]
impl ImporterQuery {
    /// Get all the import jobs deployed by the user.
    async fn user_import_reports(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<import_report::Model>> {
        let service = gql_ctx.data_unchecked::<Arc<ImporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_import_reports(user_id).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct ImporterMutation;

impl AuthProvider for ImporterMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ImporterMutation {
    /// Add job to import data from various sources.
    async fn deploy_import_job(
        &self,
        gql_ctx: &Context<'_>,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ImporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.deploy_import_job(user_id, input).await?;
        Ok(response)
    }
}
