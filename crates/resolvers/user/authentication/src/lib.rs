use std::sync::Arc;

use async_graphql::{Context, Object, Result};
use media_models::{
    AuthUserInput, LoginResult, OidcTokenOutput, RegisterResult, RegisterUserInput,
    UserTwoFactorBackupCodesResponse, UserTwoFactorInitiateResponse, UserTwoFactorSetupInput,
    UserTwoFactorVerifyInput, VerifyTwoFactorResult,
};
use traits::AuthProvider;
use user_service::UserService;

#[derive(Default)]
pub struct AuthenticationQuery;

impl AuthProvider for AuthenticationQuery {}

#[Object]
impl AuthenticationQuery {
    /// Get an authorization URL using the configured OIDC client.
    async fn get_oidc_redirect_url(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let response = service.get_oidc_redirect_url().await?;
        Ok(response)
    }

    /// Get an access token using the configured OIDC client.
    async fn get_oidc_token(&self, gql_ctx: &Context<'_>, code: String) -> Result<OidcTokenOutput> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let response = service.get_oidc_token(code).await?;
        Ok(response)
    }

    /// Get user by OIDC issuer ID.
    async fn user_by_oidc_issuer_id(
        &self,
        gql_ctx: &Context<'_>,
        oidc_issuer_id: String,
    ) -> Result<Option<String>> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let response = service.user_by_oidc_issuer_id(oidc_issuer_id).await?;
        Ok(response)
    }
}

#[derive(Default)]
pub struct AuthenticationMutation;

impl AuthProvider for AuthenticationMutation {
    fn is_mutation(&self) -> bool {
        true
    }
}

#[Object]
impl AuthenticationMutation {
    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: RegisterUserInput,
    ) -> Result<RegisterResult> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let requester_user_id = self.user_id_from_ctx(gql_ctx).await.ok();
        let response = service.register_user(requester_user_id, input).await?;
        Ok(response)
    }

    /// Login a user using their username and password and return an auth token.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: AuthUserInput) -> Result<LoginResult> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let response = service.login_user(input).await?;
        Ok(response)
    }

    /// Logout the current user by invalidating their session.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let session_id = self.user_session_id_from_ctx(gql_ctx)?;
        let response = service.logout_user(session_id).await?;
        Ok(response)
    }

    /// Generate an auth token without any expiry.
    async fn generate_auth_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.generate_auth_token(user_id).await?;
        Ok(response)
    }

    /// Verify a two-factor authentication code (TOTP or backup code).
    async fn verify_two_factor(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTwoFactorVerifyInput,
    ) -> Result<VerifyTwoFactorResult> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let response = service.verify_two_factor(input).await?;
        Ok(response)
    }

    /// Initiate two-factor authentication setup by generating a TOTP secret.
    async fn initiate_two_factor_setup(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<UserTwoFactorInitiateResponse> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.initiate_two_factor_setup(user_id).await?;
        Ok(response)
    }

    /// Complete two-factor authentication setup by verifying the TOTP code.
    async fn complete_two_factor_setup(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTwoFactorSetupInput,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.complete_two_factor_setup(user_id, input).await?;
        Ok(response)
    }

    /// Disable two-factor authentication for the currently logged in user.
    async fn disable_two_factor(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.disable_two_factor(user_id).await?;
        Ok(response)
    }

    /// Regenerate backup codes for the currently logged in user.
    async fn regenerate_two_factor_backup_codes(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        let service = gql_ctx.data_unchecked::<Arc<UserService>>();
        let user_id = self.user_id_from_ctx(gql_ctx).await?;
        let response = service.regenerate_two_factor_backup_codes(user_id).await?;
        Ok(response)
    }
}
