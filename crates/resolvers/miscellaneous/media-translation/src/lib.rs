use async_graphql::{Context, Object, Result as GraphqlResult};
use media_models::{MediaTranslationInput, MediaTranslationResult};
use traits::GraphqlDependencyInjector;

#[derive(Default)]
pub struct MiscellaneousMediaTranslationQueryResolver;

impl GraphqlDependencyInjector for MiscellaneousMediaTranslationQueryResolver {}

#[Object]
impl MiscellaneousMediaTranslationQueryResolver {
    /// Fetch translation for a given media item.
    async fn media_translation(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaTranslationInput,
    ) -> GraphqlResult<MediaTranslationResult> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_media_translation_service::media_translation(&user_id, input, service)
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
        input: MediaTranslationInput,
    ) -> GraphqlResult<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_media_translation_service::deploy_update_media_translations_job(
                user_id, input, service,
            )
            .await?,
        )
    }
}
