use std::sync::Arc;

use anyhow::Result;
use common_models::StringIdObject;
use database_models::{access_link, integration, notification_platform};
use database_utils::server_key_validation_guard;
use dependent_models::{
    BasicUserDetails, CachedResponse, UserDetailsResult, UserMetadataRecommendationsResponse,
};
use dependent_utils::is_server_key_validated;
use media_models::{
    AuthUserInput, CreateAccessLinkInput, CreateOrUpdateUserIntegrationInput,
    CreateUserInvitationInput, CreateUserNotificationPlatformInput, LoginResult, OidcTokenOutput,
    ProcessAccessLinkInput, ProcessAccessLinkResult, RegisterResult, RegisterUserInput,
    SetPasswordViaSessionInput, UpdateUserNotificationPlatformInput, UserInvitationResponse,
    UserResetResult, UserTwoFactorBackupCodesResponse, UserTwoFactorInitiateResponse,
    UserTwoFactorSetupInput, UserTwoFactorVerifyInput, VerifyTwoFactorResult,
};
use openidconnect::Nonce;
use supporting_service::SupportingService;
use user_models::{UpdateUserInput, UserPreferences};

mod access_link_operations;
mod authentication_operations;
mod integration_operations;
mod notification_operations;
mod oidc_operations;
mod password_change_operations;
mod recommendation_operations;
mod two_factor_operations;
mod user_data_operations;
mod user_management_operations;
mod user_preferences_operations;

fn empty_nonce_verifier(_nonce: Option<&Nonce>) -> Result<(), String> {
    Ok(())
}

pub struct UserService(pub Arc<SupportingService>);

impl UserService {
    pub async fn user_metadata_recommendations(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<UserMetadataRecommendationsResponse>> {
        recommendation_operations::user_metadata_recommendations(&self.0, user_id).await
    }

    pub async fn user_access_links(&self, user_id: &String) -> Result<Vec<access_link::Model>> {
        user_data_operations::user_access_links(&self.0, user_id).await
    }

    pub async fn create_access_link(
        &self,
        input: CreateAccessLinkInput,
        user_id: String,
    ) -> Result<StringIdObject> {
        access_link_operations::create_access_link(&self.0, input, user_id).await
    }

    pub async fn process_access_link(
        &self,
        input: ProcessAccessLinkInput,
    ) -> Result<ProcessAccessLinkResult> {
        access_link_operations::process_access_link(&self.0, input).await
    }

    pub async fn revoke_access_link(&self, access_link_id: String) -> Result<bool> {
        server_key_validation_guard(is_server_key_validated(&self.0).await?).await?;
        authentication_operations::revoke_access_link(&self.0, access_link_id).await
    }

    pub async fn users_list(&self, query: Option<String>) -> Result<Vec<BasicUserDetails>> {
        user_data_operations::users_list(&self.0, query).await
    }

    pub async fn delete_user(
        &self,
        admin_user_id: String,
        to_delete_user_id: String,
    ) -> Result<bool> {
        user_management_operations::delete_user(&self.0, admin_user_id, to_delete_user_id).await
    }

    pub async fn reset_user(
        &self,
        admin_user_id: String,
        to_reset_user_id: String,
    ) -> Result<UserResetResult> {
        user_management_operations::reset_user(&self.0, admin_user_id, to_reset_user_id).await
    }

    pub async fn register_user(&self, input: RegisterUserInput) -> Result<RegisterResult> {
        user_management_operations::register_user(&self.0, input).await
    }

    pub async fn generate_auth_token(&self, user_id: String) -> Result<String> {
        authentication_operations::generate_auth_token(&self.0, user_id).await
    }

    pub async fn login_user(&self, input: AuthUserInput) -> Result<LoginResult> {
        authentication_operations::login_user(&self.0, input).await
    }

    pub async fn logout_user(&self, session_id: String) -> Result<bool> {
        authentication_operations::logout_user(&self.0, session_id).await
    }

    pub async fn update_user(
        &self,
        user_id: Option<String>,
        input: UpdateUserInput,
    ) -> Result<StringIdObject> {
        user_management_operations::update_user(&self.0, user_id, input).await
    }

    pub async fn update_user_preference(
        &self,
        user_id: String,
        input: UserPreferences,
    ) -> Result<bool> {
        user_preferences_operations::update_user_preference(&self.0, &user_id, input).await
    }

    pub async fn create_or_update_user_integration(
        &self,
        user_id: String,
        input: CreateOrUpdateUserIntegrationInput,
    ) -> Result<bool> {
        integration_operations::create_or_update_user_integration(&self.0, user_id, input).await
    }

    pub async fn delete_user_integration(
        &self,
        user_id: String,
        integration_id: String,
    ) -> Result<bool> {
        integration_operations::delete_user_integration(&self.0, user_id, integration_id).await
    }

    pub async fn create_user_notification_platform(
        &self,
        user_id: String,
        input: CreateUserNotificationPlatformInput,
    ) -> Result<String> {
        notification_operations::create_user_notification_platform(&self.0, user_id, input).await
    }

    pub async fn update_user_notification_platform(
        &self,
        user_id: String,
        input: UpdateUserNotificationPlatformInput,
    ) -> Result<bool> {
        notification_operations::update_user_notification_platform(&self.0, user_id, input).await
    }

    pub async fn delete_user_notification_platform(
        &self,
        user_id: String,
        notification_id: String,
    ) -> Result<bool> {
        notification_operations::delete_user_notification_platform(
            &self.0,
            user_id,
            notification_id,
        )
        .await
    }

    pub async fn test_user_notification_platforms(&self, user_id: &String) -> Result<bool> {
        notification_operations::test_user_notification_platforms(&self.0, user_id).await
    }

    pub async fn user_details(&self, session_id: &str) -> Result<UserDetailsResult> {
        authentication_operations::user_details(&self.0, session_id).await
    }

    pub async fn user_integrations(&self, user_id: &String) -> Result<Vec<integration::Model>> {
        user_data_operations::user_integrations(&self.0, user_id).await
    }

    pub async fn user_notification_platforms(
        &self,
        user_id: &String,
    ) -> Result<Vec<notification_platform::Model>> {
        user_data_operations::user_notification_platforms(&self.0, user_id).await
    }

    pub async fn get_oidc_redirect_url(&self) -> Result<String> {
        oidc_operations::get_oidc_redirect_url(&self.0).await
    }

    pub async fn get_oidc_token(&self, code: String) -> Result<OidcTokenOutput> {
        oidc_operations::get_oidc_token(&self.0, code).await
    }

    pub async fn user_by_oidc_issuer_id(&self, oidc_issuer_id: String) -> Result<Option<String>> {
        user_data_operations::user_by_oidc_issuer_id(&self.0, oidc_issuer_id).await
    }

    pub async fn verify_two_factor(
        &self,
        input: UserTwoFactorVerifyInput,
    ) -> Result<VerifyTwoFactorResult> {
        two_factor_operations::verify_two_factor(&self.0, input).await
    }

    pub async fn initiate_two_factor_setup(
        &self,
        user_id: String,
    ) -> Result<UserTwoFactorInitiateResponse> {
        two_factor_operations::initiate_two_factor_setup(&self.0, user_id).await
    }

    pub async fn complete_two_factor_setup(
        &self,
        user_id: String,
        input: UserTwoFactorSetupInput,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        two_factor_operations::complete_two_factor_setup(&self.0, user_id, input).await
    }

    pub async fn disable_two_factor(&self, user_id: String) -> Result<bool> {
        two_factor_operations::disable_two_factor(&self.0, user_id).await
    }

    pub async fn regenerate_two_factor_backup_codes(
        &self,
        user_id: String,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        two_factor_operations::regenerate_two_factor_backup_codes(&self.0, user_id).await
    }

    pub async fn generate_password_change_session(&self, user_id: String) -> Result<bool> {
        password_change_operations::generate_password_change_session(&self.0, user_id).await?;
        Ok(true)
    }

    pub async fn create_user_invitation(
        &self,
        user_id: Option<String>,
        input: CreateUserInvitationInput,
    ) -> Result<UserInvitationResponse> {
        password_change_operations::create_user_invitation(&self.0, user_id, input).await
    }

    pub async fn set_password_via_session(
        &self,
        input: SetPasswordViaSessionInput,
    ) -> Result<bool> {
        password_change_operations::set_password_via_session(
            &self.0,
            input.session_id,
            input.password,
        )
        .await
    }
}
