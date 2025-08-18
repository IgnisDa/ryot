use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use common_models::ExportJob;
use exporter_service::ExporterService;
use traits::AuthProvider;

#[derive(Default)]
pub struct ExporterQueryResolver;

impl AuthProvider for ExporterQueryResolver {}

#[Object]
impl ExporterQueryResolver {
    /// Get all the export jobs for the current user.
    async fn user_exports(&self, gql_ctx: &Context<'_>) -> Result<Vec<ExportJob>> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.user_exports(user_id).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct ExporterMutationResolver;

impl AuthProvider for ExporterMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ExporterMutationResolver {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<ExporterService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.deploy_export_job(user_id).await?;
        Ok(response)
    }
}
