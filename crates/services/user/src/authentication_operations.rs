use std::sync::Arc;

use application_utils::user_id_from_token;
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use async_graphql::Result;
use chrono::Utc;
use database_models::{prelude::User, user};
use database_utils::{revoke_access_link as db_revoke_access_link, user_by_id};
use dependent_models::UserDetailsResult;
use jwt_service::sign;
use media_models::{
    AuthUserInput, LoginError, LoginErrorVariant, LoginResponse, LoginResult, PasswordUserInput,
};
use media_models::{UserDetailsError, UserDetailsErrorVariant};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn generate_auth_token(ss: &Arc<SupportingService>, user_id: String) -> Result<String> {
    let auth_token = sign(
        user_id,
        &ss.config.users.jwt_secret,
        ss.config.users.token_valid_for_days,
        None,
    )?;
    Ok(auth_token)
}

pub async fn revoke_access_link(
    ss: &Arc<SupportingService>,
    access_link_id: String,
) -> Result<bool> {
    db_revoke_access_link(&ss.db, access_link_id).await
}

pub async fn user_details(ss: &Arc<SupportingService>, token: &str) -> Result<UserDetailsResult> {
    let found_token = user_id_from_token(token, &ss.config.users.jwt_secret);
    let Ok(user_id) = found_token else {
        return Ok(UserDetailsResult::Error(UserDetailsError {
            error: UserDetailsErrorVariant::AuthTokenInvalid,
        }));
    };
    let user = user_by_id(&user_id, ss).await?;
    Ok(UserDetailsResult::Ok(Box::new(user)))
}

pub async fn login_user(ss: &Arc<SupportingService>, input: AuthUserInput) -> Result<LoginResult> {
    let filter = match input.clone() {
        AuthUserInput::Oidc(input) => user::Column::OidcIssuerId.eq(input.issuer_id),
        AuthUserInput::Password(input) => user::Column::Name.eq(input.username),
    };
    let Some(user) = User::find().filter(filter).one(&ss.db).await? else {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::UsernameDoesNotExist,
        }));
    };
    if user.is_disabled.unwrap_or_default() {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::AccountDisabled,
        }));
    }
    if ss.config.users.validate_password {
        if let AuthUserInput::Password(PasswordUserInput { password, .. }) = input {
            if let Some(hashed_password) = &user.password {
                let parsed_hash = PasswordHash::new(hashed_password).unwrap();
                if Argon2::default()
                    .verify_password(password.as_bytes(), &parsed_hash)
                    .is_err()
                {
                    return Ok(LoginResult::Error(LoginError {
                        error: LoginErrorVariant::CredentialsMismatch,
                    }));
                }
            } else {
                return Ok(LoginResult::Error(LoginError {
                    error: LoginErrorVariant::IncorrectProviderChosen,
                }));
            }
        }
    }
    let jwt_key = generate_auth_token(ss, user.id.clone()).await?;
    let mut user: user::ActiveModel = user.into();
    user.last_login_on = ActiveValue::Set(Some(Utc::now()));
    user.update(&ss.db).await?;
    Ok(LoginResult::Ok(LoginResponse { api_key: jwt_key }))
}
