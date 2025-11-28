use async_graphql::{Context, Object, Result};
use common_models::BackgroundJob;
use dependent_models::CoreDetails;
use enum_models::EntityLot;
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};
use uuid::Uuid;

#[derive(Default)]
pub struct MiscellaneousSystemQueryResolver;

impl AuthProvider for MiscellaneousSystemQueryResolver {}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousSystemQueryResolver {}

#[Object]
impl MiscellaneousSystemQueryResolver {
    /// Get some primary information about the service.
    async fn core_details(&self, gql_ctx: &Context<'_>) -> Result<CoreDetails> {
        let service = self.svc(gql_ctx);
        Ok(service.core_details().await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousSystemMutationResolver;

impl AuthProvider for MiscellaneousSystemMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousSystemMutationResolver {}

#[Object]
impl MiscellaneousSystemMutationResolver {
    /// Expire a cache key by its ID
    async fn expire_cache_key(&self, gql_ctx: &Context<'_>, cache_id: Uuid) -> Result<bool> {
        let service = self.svc(gql_ctx);
        Ok(service.expire_cache_key(cache_id).await?)
    }

    /// Deploy a job to update a media entity's metadata.
    async fn deploy_update_media_entity_job(
        &self,
        gql_ctx: &Context<'_>,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        let service = self.svc(gql_ctx);
        Ok(service
            .deploy_update_media_entity_job(entity_id, entity_lot)
            .await?)
    }

    /// Deploy a job to update a media entity's translations.
    async fn deploy_update_media_entity_translations_job(
        &self,
        gql_ctx: &Context<'_>,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .deploy_update_media_entity_translations_job(user_id, entity_id, entity_lot)
            .await?)
    }

    /// Start a background job.
    async fn deploy_background_job(
        &self,
        gql_ctx: &Context<'_>,
        job_name: BackgroundJob,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.deploy_background_job(&user_id, job_name).await?)
    }

    /// Generate a one-time URL for downloading application logs. Admin only.
    async fn generate_log_download_url(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.generate_log_download_url(&user_id).await?)
    }

    /// Use this mutation to call a function that needs to be tested for implementation.
    /// It is only available in development mode.
    #[cfg(debug_assertions)]
    async fn development_mutation(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = self.svc(gql_ctx);
        Ok(service.development_mutation().await?)
    }
}
