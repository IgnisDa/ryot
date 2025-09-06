use async_graphql::{Context, Object, Result};
use common_models::StringIdObject;
use dependent_models::{
    CachedResponse, UserMetadataDetails, UserMetadataListInput, UserMetadataListResponse,
};
use media_models::{
    CreateCustomMetadataInput, GraphqlMetadataDetails, MarkEntityAsPartialInput,
    MetadataDetailsInput, UpdateCustomMetadataInput,
};
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
        input: MetadataDetailsInput,
    ) -> Result<GraphqlMetadataDetails> {
        let service = self.svc(gql_ctx);
        Ok(service.metadata_details(input).await?)
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
    ) -> Result<UserMetadataDetails> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_metadata_details(user_id, metadata_id).await?)
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
    /// Create a custom media item.
    async fn create_custom_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMetadataInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        let metadata = service.create_custom_metadata(user_id, input).await?;
        Ok(StringIdObject { id: metadata.id })
    }

    /// Update custom metadata.
    async fn update_custom_metadata(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.update_custom_metadata(&user_id, input).await?)
    }

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
