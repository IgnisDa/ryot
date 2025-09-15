use async_graphql::{Context, Object, Result};
use common_models::StringIdObject;
use custom_service::CustomService;
use database_models::exercise;
use dependent_models::UpdateCustomExerciseInput;
use media_models::{
    CreateCustomMetadataGroupInput, CreateCustomMetadataInput, CreateCustomPersonInput,
    UpdateCustomMetadataInput,
};
use traits::{AuthProvider, GraphqlResolverSvc};

#[derive(Default)]
pub struct CustomMutationResolver;

impl AuthProvider for CustomMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<CustomService> for CustomMutationResolver {}

#[Object]
impl CustomMutationResolver {
    /// Create a custom exercise.
    async fn create_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: exercise::Model,
    ) -> Result<String> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.create_custom_exercise(&user_id, input).await?)
    }

    /// Update a custom exercise.
    async fn update_custom_exercise(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.update_custom_exercise(user_id, input).await?)
    }

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

    /// Create a custom metadata group.
    async fn create_custom_metadata_group(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomMetadataGroupInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        let group = service
            .create_custom_metadata_group(&user_id, input)
            .await?;
        Ok(StringIdObject { id: group.id })
    }

    /// Update a custom metadata group.
    async fn update_custom_metadata_group(
        &self,
        gql_ctx: &Context<'_>,
        input: media_models::UpdateCustomMetadataGroupInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .update_custom_metadata_group(&user_id, input)
            .await?)
    }

    /// Create a custom person.
    async fn create_custom_person(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateCustomPersonInput,
    ) -> Result<StringIdObject> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        let p = service.create_custom_person(&user_id, input).await?;
        Ok(StringIdObject { id: p.id })
    }

    /// Update a custom person.
    async fn update_custom_person(
        &self,
        gql_ctx: &Context<'_>,
        input: media_models::UpdateCustomPersonInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.update_custom_person(&user_id, input).await?)
    }
}
