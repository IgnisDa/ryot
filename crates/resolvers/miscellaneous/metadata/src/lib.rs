use async_graphql::{Context, Object, Result};
use dependent_models::{
    CachedResponse, UserMetadataDetails, UserMetadataListInput, UserMetadataListResponse,
};
use enum_models::EntityLot;
use media_models::{GraphqlMetadataDetails, MarkEntityAsPartialInput};
use miscellaneous_service::MiscellaneousService;
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct MiscellaneousMetadataQueryResolver;

impl AuthProvider for MiscellaneousMetadataQueryResolver {}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousMetadataQueryResolver {}

#[Object]
impl MiscellaneousMetadataQueryResolver {
    /// Get details about a media present in the database.
    async fn metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<CachedResponse<GraphqlMetadataDetails>> {
        let service = self.svc(gql_ctx);
        Ok(service.metadata_details(&metadata_id).await?)
    }

    /// Get all the media items related to a user for a specific media type.
    async fn user_metadata_list(
        &self,
        gql_ctx: &Context<'_>,
        input: UserMetadataListInput,
    ) -> Result<CachedResponse<UserMetadataListResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_metadata_list(user_id, input).await?)
    }

    /// Get details that can be displayed to a user for a media.
    async fn user_metadata_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<CachedResponse<UserMetadataDetails>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_metadata_details(user_id, metadata_id).await?)
    }

    /// Returns whether the current user has recently consumed the specified entity.
    async fn user_entity_recently_consumed(
        &self,
        gql_ctx: &Context<'_>,
        entity_id: String,
        entity_lot: EntityLot,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .is_entity_recently_consumed(user_id, entity_id, entity_lot)
            .await?)
    }
}

#[derive(Default)]
pub struct MiscellaneousMetadataMutationResolver;

impl AuthProvider for MiscellaneousMetadataMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<MiscellaneousService> for MiscellaneousMetadataMutationResolver {}

#[Object]
impl MiscellaneousMetadataMutationResolver {
    /// Merge a media item into another. This will move all `seen`, `collection`
    /// and `review` associations with to the metadata.
    async fn merge_metadata(
        &self,
        gql_ctx: &Context<'_>,
        merge_from: String,
        merge_into: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .merge_metadata(user_id, merge_from, merge_into)
            .await?)
    }

    /// Delete all history and reviews for a given media item and remove it from all
    /// collections for the user.
    async fn disassociate_metadata(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.disassociate_metadata(user_id, metadata_id).await?)
    }

    /// Mark an entity as partial.
    async fn mark_entity_as_partial(
        &self,
        gql_ctx: &Context<'_>,
        input: MarkEntityAsPartialInput,
    ) -> Result<bool> {
        let (service, _) = self.svc_and_user(gql_ctx).await?;
        Ok(service.mark_entity_as_partial(input).await?)
    }
}
