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
