use async_graphql::{Context, Object, Result};
use common_models::EntityWithLot;
use dependent_models::{CachedResponse, EntityTranslationDetailsResponse};
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct MiscellaneousMediaTranslationQueryResolver;

impl GraphqlDependencyInjector for MiscellaneousMediaTranslationQueryResolver {}

#[Object]
impl MiscellaneousMediaTranslationQueryResolver {
    /// Fetch translations for a given media item.
    async fn media_translations(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityWithLot,
    ) -> Result<CachedResponse<EntityTranslationDetailsResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_media_translation_service::media_translations(&user_id, input, service)
                .await?,
        )
    }
}

#[derive(Default)]
pub struct MiscellaneousMediaTranslationMutationResolver;

impl GraphqlDependencyInjector for MiscellaneousMediaTranslationMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl MiscellaneousMediaTranslationMutationResolver {
    /// Deploy a job to update media translations in the background.
    async fn deploy_update_media_translations_job(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityWithLot,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_media_translation_service::deploy_update_media_translations_job(
                user_id, input, service,
            )
            .await?,
        )
    }
}
