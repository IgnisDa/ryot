use async_graphql::{Context, Object, Result};
use common_models::BackgroundJob;
use database_models::entity_translation;
use dependent_models::{CachedResponse, CoreDetails};
use enum_models::EntityLot;
use media_models::EntityTranslationInput;
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

    /// Get the translations of an entity using the user's preferred language.
    async fn entity_translation_details(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityTranslationInput,
    ) -> Result<CachedResponse<Vec<entity_translation::Model>>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.entity_translation_details(user_id, input).await?)
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

    /// Update a media entity's translations. The language code is
    /// extracted from the user's preferences.
    async fn update_media_entity_translation(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityTranslationInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .update_media_entity_translation(user_id, input)
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
