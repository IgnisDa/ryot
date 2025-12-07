use async_graphql::{Context, Object, Result};
use common_models::{BackgroundJob, EntityWithLot};
use dependent_models::CoreDetails;
use traits::GraphqlDependencyInjector;
use uuid::Uuid;

#[derive(Default)]
pub struct MiscellaneousSystemQueryResolver;

impl GraphqlDependencyInjector for MiscellaneousSystemQueryResolver {}

#[Object]
impl MiscellaneousSystemQueryResolver {
    /// Get some primary information about the service.
    async fn core_details(&self, gql_ctx: &Context<'_>) -> Result<CoreDetails> {
        let service = self.dependency(gql_ctx);
        Ok(dependent_core_utils::core_details(service).await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousSystemMutationResolver;

impl GraphqlDependencyInjector for MiscellaneousSystemMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl MiscellaneousSystemMutationResolver {
    /// Expire a cache key by its ID
    async fn expire_cache_key(&self, gql_ctx: &Context<'_>, cache_id: Uuid) -> Result<bool> {
        let service = self.dependency(gql_ctx);
        Ok(miscellaneous_general_service::expire_cache_key(service, cache_id).await?)
    }

    /// Start a background job.
    async fn deploy_background_job(
        &self,
        gql_ctx: &Context<'_>,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(dependent_jobs_utils::deploy_background_job(&user_id, job_name, service).await?)
    }

    /// Deploy a job to update a media entity's metadata.
    async fn deploy_update_media_entity_job(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityWithLot,
    ) -> Result<bool> {
        let (service, _) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_service::deploy_update_media_entity_job(input, service).await?)
    }

    /// Generate a one-time URL for downloading application logs. Admin only.
    async fn generate_log_download_url(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(miscellaneous_service::generate_log_download_url(service, &user_id).await?)
    }

    /// Use this mutation to call a function that needs to be tested for implementation.
    /// It is only available in development mode.
    #[cfg(debug_assertions)]
    async fn development_mutation(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = self.dependency(gql_ctx);
        Ok(miscellaneous_service::development_mutation(service).await?)
    }
}
