use async_graphql::{Context, Object, Result};
use common_models::EntityWithLot;
use dependent_models::CachedResponse;
use media_models::EntityTranslationDetails;
use traits::{AuthProvider, GraphqlResolverDependency};

#[derive(Default)]
pub struct MiscellaneousTranslationQueryResolver;

impl AuthProvider for MiscellaneousTranslationQueryResolver {}
impl GraphqlResolverDependency for MiscellaneousTranslationQueryResolver {}

#[Object]
impl MiscellaneousTranslationQueryResolver {
    async fn get_entity_translations(
        &self,
        gql_ctx: &Context<'_>,
        entity: EntityWithLot,
    ) -> Result<CachedResponse<EntityTranslationDetails>> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        todo!()
    }
}
