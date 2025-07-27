use async_graphql::{Enum, InputObject, OneofObject, SimpleObject, Union};
use common_models::StringIdObject;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum UserDetailsErrorVariant {
    SessionInvalid,
}

#[derive(Debug, SimpleObject)]
pub struct UserDetailsError {
    pub error: UserDetailsErrorVariant,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct PasswordUserInput {
    pub username: String,
    #[graphql(secret)]
    pub password: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct OidcUserInput {
    pub email: String,
    #[graphql(secret)]
    pub issuer_id: String,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum AuthUserInput {
    Oidc(OidcUserInput),
    Password(PasswordUserInput),
}

#[derive(Debug, InputObject)]
pub struct RegisterUserInput {
    pub data: AuthUserInput,
    /// Specific user ID to create.
    #[graphql(skip)]
    pub user_id: Option<String>,
    /// If registration is disabled, this can be used to override it.
    pub admin_access_token: Option<String>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum RegisterErrorVariant {
    Disabled,
    IdentifierAlreadyExists,
}

#[derive(Debug, SimpleObject)]
pub struct RegisterError {
    pub error: RegisterErrorVariant,
}

#[derive(Union)]
pub enum RegisterResult {
    Ok(StringIdObject),
    Error(RegisterError),
}

#[derive(Debug, SimpleObject)]
pub struct UserResetResponse {
    pub id: String,
    pub password: Option<String>,
}

#[derive(Union)]
pub enum UserResetResult {
    Error(RegisterError),
    Ok(UserResetResponse),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum LoginErrorVariant {
    AccountDisabled,
    CredentialsMismatch,
    UsernameDoesNotExist,
    IncorrectProviderChosen,
}

#[derive(Debug, SimpleObject)]
pub struct LoginError {
    pub error: LoginErrorVariant,
}

#[derive(Debug, SimpleObject)]
pub struct ApiKeyResponse {
    pub api_key: String,
}

#[derive(Union)]
pub enum LoginResult {
    Error(LoginError),
    Ok(ApiKeyResponse),
    TwoFactorRequired(StringIdObject),
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone, Default)]
pub struct OidcTokenOutput {
    pub email: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct CreateAccessLinkInput {
    pub name: String,
    pub maximum_uses: Option<i32>,
    pub redirect_to: Option<String>,
    pub expires_on: Option<DateTimeUtc>,
    pub is_account_default: Option<bool>,
    pub is_mutation_allowed: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, OneofObject, Clone)]
pub enum ProcessAccessLinkInput {
    Id(String),
    Username(String),
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum ProcessAccessLinkErrorVariant {
    Expired,
    Revoked,
    NotFound,
    MaximumUsesReached,
}

#[derive(Debug, SimpleObject)]
pub struct ProcessAccessLinkError {
    pub error: ProcessAccessLinkErrorVariant,
}

#[derive(Debug, SimpleObject)]
pub struct ProcessAccessLinkResponse {
    pub api_key: String,
    pub token_valid_for_days: i32,
    pub redirect_to: Option<String>,
}

#[derive(Union)]
pub enum ProcessAccessLinkResult {
    Ok(ProcessAccessLinkResponse),
    Error(ProcessAccessLinkError),
}

#[derive(Debug, SimpleObject)]
pub struct UserTwoFactorInitiateResponse {
    #[graphql(secret)]
    pub secret: String,
    pub qr_code_url: String,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct UserTwoFactorSetupInput {
    pub totp_code: String,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum UserTwoFactorVerifyMethod {
    Totp,
    BackupCode,
}

#[derive(Debug, InputObject, Serialize, Deserialize, Clone)]
pub struct UserTwoFactorVerifyInput {
    pub code: String,
    pub user_id: String,
    pub method: UserTwoFactorVerifyMethod,
}

#[derive(Debug, SimpleObject)]
pub struct UserTwoFactorBackupCodesResponse {
    pub backup_codes: Vec<String>,
}

#[derive(Enum, Clone, Debug, Copy, PartialEq, Eq)]
pub enum VerifyTwoFactorErrorVariant {
    Invalid,
    RateLimited,
}

#[derive(Debug, SimpleObject)]
pub struct VerifyTwoFactorError {
    pub error: VerifyTwoFactorErrorVariant,
}

#[derive(Union)]
pub enum VerifyTwoFactorResult {
    Ok(ApiKeyResponse),
    Error(VerifyTwoFactorError),
}
