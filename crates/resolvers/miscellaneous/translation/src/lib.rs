use async_graphql::{Context, Object, Result};
use common_models::EntityWithLot;
use dependent_models::{CachedResponse, EntityTranslationDetailsResponse};
use traits::{AuthProvider, GraphqlResolverDependency};

#[derive(Default)]
pub struct MiscellaneousTranslationQueryResolver;

impl AuthProvider for MiscellaneousTranslationQueryResolver {}
impl GraphqlResolverDependency for MiscellaneousTranslationQueryResolver {}

#[Object]
impl MiscellaneousTranslationQueryResolver {
    /// Fetch translations for a given entity.
    async fn entity_translations(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityWithLot,
    ) -> Result<CachedResponse<EntityTranslationDetailsResponse>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_translation_service::entity_translations(&user_id, input, &service)
                .await?,
        )
    }
}

#[derive(Default)]
pub struct MiscellaneousTranslationMutationResolver;

impl AuthProvider for MiscellaneousTranslationMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for MiscellaneousTranslationMutationResolver {}

#[Object]
impl MiscellaneousTranslationMutationResolver {
    /// Deploy a job to update entity translations in the background.
    async fn deploy_update_entity_translations_job(
        &self,
        gql_ctx: &Context<'_>,
        input: EntityWithLot,
    ) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(
            miscellaneous_translation_service::deploy_update_entity_translations_job(
                &service,
                user_id,
                input.clone(),
            )
            .await?,
        )
    }
}
