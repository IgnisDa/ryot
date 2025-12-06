use async_graphql::{Context, Object, Result};
use common_models::ExportJob;
use exporter_service::export_operations::{deploy_export_job, user_exports};
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct ExporterQueryResolver;

impl GraphqlDependencyInjector for ExporterQueryResolver {}

#[Object]
impl ExporterQueryResolver {
    /// Get all the export jobs for the current user.
    async fn user_exports(&self, gql_ctx: &Context<'_>) -> Result<Vec<ExportJob>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(user_exports(service, user_id).await?)
    }
}

#[derive(Default)]
pub struct ExporterMutationResolver;

impl GraphqlDependencyInjector for ExporterMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl ExporterMutationResolver {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(deploy_export_job(service, user_id).await?)
    }
}
