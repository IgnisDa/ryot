use async_graphql::{Context, Object, Result};
use common_models::ExportJob;
use exporter_service::ExporterService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct ExporterQueryResolver;

impl AuthProvider for ExporterQueryResolver {}

impl GraphqlResolverSvc<ExporterService> for ExporterQueryResolver {}

#[Object]
impl ExporterQueryResolver {
    /// Get all the export jobs for the current user.
    async fn user_exports(&self, gql_ctx: &Context<'_>) -> Result<Vec<ExportJob>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_exports(user_id).await?)
    }
}

#[derive(Default)]
pub struct ExporterMutationResolver;

impl AuthProvider for ExporterMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<ExporterService> for ExporterMutationResolver {}

#[Object]
impl ExporterMutationResolver {
    /// Deploy a job to export data for a user.
    async fn deploy_export_job(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.deploy_export_job(user_id).await?)
    }
}
