use async_graphql::{Context, Object, Result};
use media_models::{
    AuthUserInput, LoginResult, OidcTokenOutput, RegisterResult, RegisterUserInput,
    UserTwoFactorBackupCodesResponse, UserTwoFactorInitiateResponse, UserTwoFactorSetupInput,
    UserTwoFactorVerifyInput, VerifyTwoFactorResult,
};
use traits::{AuthProvider, GraphqlResolverDependency};
use user_service::{
    authentication_operations, oidc_operations, two_factor_operations, user_data_operations,
    user_management_operations,
};

#[derive(Default)]
pub struct UserAuthenticationQueryResolver;

impl AuthProvider for UserAuthenticationQueryResolver {}
impl GraphqlResolverDependency for UserAuthenticationQueryResolver {}

#[Object]
impl UserAuthenticationQueryResolver {
    /// Get an authorization URL using the configured OIDC client.
    async fn get_oidc_redirect_url(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let service = self.dependency(gql_ctx);
        Ok(oidc_operations::get_oidc_redirect_url(service).await?)
    }

    /// Get an access token using the configured OIDC client.
    async fn get_oidc_token(&self, gql_ctx: &Context<'_>, code: String) -> Result<OidcTokenOutput> {
        let service = self.dependency(gql_ctx);
        Ok(oidc_operations::get_oidc_token(service, code).await?)
    }

    /// Get user by OIDC issuer ID.
    async fn user_by_oidc_issuer_id(
        &self,
        gql_ctx: &Context<'_>,
        oidc_issuer_id: String,
    ) -> Result<Option<String>> {
        let service = self.dependency(gql_ctx);
        Ok(user_data_operations::user_by_oidc_issuer_id(service, oidc_issuer_id).await?)
    }
}

#[derive(Default)]
pub struct UserAuthenticationMutationResolver;

impl AuthProvider for UserAuthenticationMutationResolver {
    fn is_mutation(&self) -> bool {
        true
    }
}
impl GraphqlResolverDependency for UserAuthenticationMutationResolver {}

#[Object]
impl UserAuthenticationMutationResolver {
    /// Create a new user for the service. Also set their `lot` as admin if
    /// they are the first user.
    async fn register_user(
        &self,
        gql_ctx: &Context<'_>,
        input: RegisterUserInput,
    ) -> Result<RegisterResult> {
        let (service, requester_user_id) = self.dependency_and_maybe_user(gql_ctx).await?;
        Ok(user_management_operations::register_user(service, requester_user_id, input).await?)
    }

    /// Login a user using their username and password and return an auth token.
    async fn login_user(&self, gql_ctx: &Context<'_>, input: AuthUserInput) -> Result<LoginResult> {
        let service = self.dependency(gql_ctx);
        Ok(authentication_operations::login_user(service, input).await?)
    }

    /// Logout the current user by invalidating their session.
    async fn logout_user(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let service = self.dependency(gql_ctx);
        let session_id = self.user_session_id_from_ctx(gql_ctx)?;
        Ok(authentication_operations::logout_user(service, session_id).await?)
    }

    /// Generate an auth token without any expiry.
    async fn generate_auth_token(&self, gql_ctx: &Context<'_>) -> Result<String> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(authentication_operations::generate_auth_token(service, user_id).await?)
    }

    /// Verify a two-factor authentication code (TOTP or backup code).
    async fn verify_two_factor(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTwoFactorVerifyInput,
    ) -> Result<VerifyTwoFactorResult> {
        let service = self.dependency(gql_ctx);
        Ok(two_factor_operations::verify_two_factor(service, input).await?)
    }

    /// Initiate two-factor authentication setup by generating a TOTP secret.
    async fn initiate_two_factor_setup(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<UserTwoFactorInitiateResponse> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(two_factor_operations::initiate_two_factor_setup(service, user_id).await?)
    }

    /// Complete two-factor authentication setup by verifying the TOTP code.
    async fn complete_two_factor_setup(
        &self,
        gql_ctx: &Context<'_>,
        input: UserTwoFactorSetupInput,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(two_factor_operations::complete_two_factor_setup(service, user_id, input).await?)
    }

    /// Disable two-factor authentication for the currently logged in user.
    async fn disable_two_factor(&self, gql_ctx: &Context<'_>) -> Result<bool> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(two_factor_operations::disable_two_factor(service, user_id).await?)
    }

    /// Regenerate backup codes for the currently logged in user.
    async fn regenerate_two_factor_backup_codes(
        &self,
        gql_ctx: &Context<'_>,
    ) -> Result<UserTwoFactorBackupCodesResponse> {
        let (service, user_id) = self.dependency_and_user(gql_ctx).await?;
        Ok(two_factor_operations::regenerate_two_factor_backup_codes(service, user_id).await?)
    }
}
