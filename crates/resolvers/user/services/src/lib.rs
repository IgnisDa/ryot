use async_graphql::{Context, Object, Result};
use database_models::{integration, notification_platform};
use dependent_models::{CachedResponse, UserMetadataRecommendationsResponse};
use media_models::{
    CreateOrUpdateUserIntegrationInput, CreateUserNotificationPlatformInput,
    UpdateUserNotificationPlatformInput,
};
use traits::{AuthProvider, GraphqlResolverSvc};
use user_service::UserService;

#[derive(Default)]
pub struct UserServicesQueryResolver;

impl AuthProvider for UserServicesQueryResolver {}

impl GraphqlResolverSvc<UserService> for UserServicesQueryResolver {}

#[Object]
impl UserServicesQueryResolver {
    /// Get metadata recommendations for the currently logged in user.
    async fn user_metadata_recommendations(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<CachedResponse<UserMetadataRecommendationsResponse>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_metadata_recommendations(&user_id).await?)
    }

    /// Get all the integrations for the currently logged in user.
    async fn user_integrations(&self, gql_ctx: &Context<'_>) -> Result<Vec<integration::Model>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_integrations(&user_id).await?)
    }

    /// Get all the notification platforms for the currently logged in user.
    async fn user_notification_platforms(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<Vec<notification_platform::Model>> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.user_notification_platforms(&user_id).await?)
    }
}

#[derive(Default)]
pub struct UserServicesMutationResolver;

impl AuthProvider for UserServicesMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}

impl GraphqlResolverSvc<UserService> for UserServicesMutationResolver {}

#[Object]
impl UserServicesMutationResolver {
    /// Create or update an integration for the currently logged in user.
    async fn create_or_update_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateOrUpdateUserIntegrationInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .create_or_update_user_integration(user_id, input)
            .await?)
    }

    /// Delete an integration for the currently logged in user.
    async fn delete_user_integration(
        &self,
        gql_ctx: &Context<'_>,
        integration_id: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .delete_user_integration(user_id, integration_id)
            .await?)
    }

    /// Add a notification platform for the currently logged in user.
    async fn create_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<String> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .create_user_notification_platform(user_id, input)
            .await?)
    }

    /// Edit a notification platform for the currently logged in user.
    async fn update_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        input: UpdateUserNotificationPlatformInput,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .update_user_notification_platform(user_id, input)
            .await?)
    }

    /// Delete a notification platform for the currently logged in user.
    async fn delete_user_notification_platform(
        &self,
        gql_ctx: &Context<'_>,
        notification_id: String,
    ) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service
            .delete_user_notification_platform(user_id, notification_id)
            .await?)
    }

    /// Test all notification platforms for the currently logged in user.
    async fn test_user_notification_platforms(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let (service, user_id) = self.svc_and_user(gql_ctx).await?;
        Ok(service.test_user_notification_platforms(&user_id).await?)
    }
}
