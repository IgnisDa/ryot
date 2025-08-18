use async_graphql::{Context, Object, Result};
use database_models::import_report;
use importer_service::ImporterService;
use media_models::DeployImportJobInput;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct ImporterQueryResolver;

impl AuthProvider for ImporterQueryResolver {}

impl GraphqlResolverSvc<ImporterService> for ImporterQueryResolver {}

#[Object]
impl ImporterQueryResolver {
    /// Get all the import jobs deployed by the user.
    async fn user_import_reports(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<import_report::Model>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_import_reports(user_id).await?)
    }
}

#[derive(Default)]
pub struct ImporterMutationResolver;

impl AuthProvider for ImporterMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<ImporterService> for ImporterMutationResolver {}

#[Object]
impl ImporterMutationResolver {
    /// Add job to import data from various sources.
    async fn deploy_import_job(
        &self,
        gql_ctx: &Context<'_>,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.deploy_import_job(user_id, input).await?)
    }
}
