use async_graphql::{Context, Object, Result};
use database_models::import_report;
use importer_service::job_operations;
use media_models::DeployImportJobInput;
use traits::{AuthProvider, GraphqlResolverDependency};

#[derive(Default)]
pub struct ImporterQueryResolver;

impl AuthProvider for ImporterQueryResolver {}
impl GraphqlResolverDependency for ImporterQueryResolver {}

#[Object]
impl ImporterQueryResolver {
    /// Get all the import jobs deployed by the user.
    async fn user_import_reports(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<import_report::Model>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(job_operations::user_import_reports(service, user_id).await?)
    }
}

#[derive(Default)]
pub struct ImporterMutationResolver;

impl AuthProvider for ImporterMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for ImporterMutationResolver {}

#[Object]
impl ImporterMutationResolver {
    /// Add job to import data from various sources.
    async fn deploy_import_job(
        &self,
        gql_ctx: &Context<'_>,
        input: DeployImportJobInput,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(job_operations::deploy_import_job(service, user_id, input).await?)
    }
}
