use async_graphql::{Context, Object, Result};
use common_models::EntityWithLot;
use dependent_models::CachedResponse;
use media_models::EntityTranslationDetails;
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct MiscellaneousTranslationQueryResolver;

impl AuthProvider for MiscellaneousTranslationQueryResolver {}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousTranslationQueryResolver {}

#[Object]
impl MiscellaneousTranslationQueryResolver {
    async fn get_entity_translations(
        &self,
        gql_ctx: &Context<'_>,
        entity: EntityWithLot,
    ) -> Result<CachedResponse<EntityTranslationDetails>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        todo!()
    }
}
