use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use argon2::{Argon2, PasswordHash, PasswordVerifier};
use chrono::Utc;
use common_models::StringIdObject;
use database_models::{prelude::User, user};
use database_utils::{revoke_access_link as db_revoke_access_link, user_by_id};
use dependent_models::{UserDetails, UserDetailsResult};
use media_models::{ApiKeyResponse, AuthUserInput, LoginError, LoginErrorVariant, LoginResult};
use media_models::{UserDetailsError, UserDetailsErrorVariant};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
};
use supporting_service::SupportingService;

pub async fn generate_auth_token(ss: &Arc<SupportingService>, user_id: String) -> Result<String> {
    let session_id = session_service::create_session(ss, user_id, None, None).await?;
    Ok(session_id)
}

pub async fn revoke_access_link(
    ss: &Arc<SupportingService>,
    access_link_id: String,
) -> Result<bool> {
    db_revoke_access_link(access_link_id, ss).await
}

pub async fn user_details(
    ss: &Arc<SupportingService>,
    session_id: &str,
) -> Result<UserDetailsResult> {
    let session = match session_service::validate_session(ss, session_id).await? {
        Some(session) => session,
        None => {
            return Ok(UserDetailsResult::Error(UserDetailsError {
                error: UserDetailsErrorVariant::SessionInvalid,
            }));
        }
    };
    let user = user_by_id(&session.user_id, ss).await?;
    let details = UserDetails {
        id: user.id,
        lot: user.lot,
        name: user.name,
        preferences: user.preferences,
        is_disabled: user.is_disabled,
        oidc_issuer_id: user.oidc_issuer_id,
        access_link_id: session.access_link_id,
        extra_information: user.extra_information,
        times_two_factor_backup_codes_used: user.two_factor_information.as_ref().map(|info| {
            info.backup_codes
                .iter()
                .filter(|code| code.used_at.is_some())
                .count()
        }),
    };
    Ok(UserDetailsResult::Ok(Box::new(details)))
}

pub async fn login_user(ss: &Arc<SupportingService>, input: AuthUserInput) -> Result<LoginResult> {
    let input = match input {
        AuthUserInput::Oidc(_) => bail!("OIDC login requires a verified authorization flow"),
        AuthUserInput::Password(input) => input,
    };
    if ss.config.users.disable_local_auth {
        bail!("Local authentication is disabled");
    }
    let Some(user) = User::find()
        .filter(user::Column::Name.eq(input.username))
        .one(&ss.db)
        .await?
    else {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::UsernameDoesNotExist,
        }));
    };
    let Some(hashed_password) = &user.password else {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::IncorrectProviderChosen,
        }));
    };
    if user.oidc_issuer_id.is_some() {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::IncorrectProviderChosen,
        }));
    }
    if ss.config.users.validate_password {
        let parsed_hash = PasswordHash::new(hashed_password)
            .map_err(|_| anyhow!("Invalid password hash format"))?;
        if Argon2::default()
            .verify_password(input.password.as_bytes(), &parsed_hash)
            .is_err()
        {
            return Ok(LoginResult::Error(LoginError {
                error: LoginErrorVariant::CredentialsMismatch,
            }));
        }
    }
    login_authenticated_user(ss, user).await
}

pub(crate) async fn login_authenticated_user(
    ss: &Arc<SupportingService>,
    user: user::Model,
) -> Result<LoginResult> {
    if user.is_disabled.unwrap_or_default() {
        return Ok(LoginResult::Error(LoginError {
            error: LoginErrorVariant::AccountDisabled,
        }));
    }
    if user.two_factor_information.is_some() && ss.config.users.validate_password {
        return Ok(LoginResult::TwoFactorRequired(StringIdObject {
            id: user.id.clone(),
        }));
    }
    let session_id = generate_auth_token(ss, user.id.clone()).await?;
    let mut user = user.into_active_model();
    user.last_login_on = ActiveValue::Set(Some(Utc::now()));
    user.update(&ss.db).await?;
    Ok(LoginResult::Ok(ApiKeyResponse {
        api_key: session_id,
    }))
}

pub async fn logout_user(ss: &Arc<SupportingService>, session_id: String) -> Result<bool> {
    session_service::invalidate_session(ss, &session_id).await?;
    Ok(true)
}
