use std::sync::Arc;

use anyhow::{Result, bail};
use common_utils::generate_session_id;
use database_utils::{admin_account_guard, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ExpireCacheKeyInput,
    UserPasswordChangeSessionInput, UserPasswordChangeSessionValue,
};
use media_models::{GetPasswordChangeUrlInput, UserInvitationResponse};
use sea_orm::{ActiveModelTrait, ActiveValue, IntoActiveModel};
use supporting_service::SupportingService;

pub fn build_password_change_url(frontend_url: &str, session_id: &str) -> String {
    format!("{}/change-password?sessionId={}", frontend_url, session_id)
}

pub async fn generate_password_change_session(
    ss: &Arc<SupportingService>,
    user_id: String,
) -> Result<String> {
    let user = user_by_id(&user_id, ss).await?;

    if user.oidc_issuer_id.is_some() {
        bail!("Password change not available for OIDC users");
    }

    let session_id = generate_session_id(None);
    let cache_key =
        ApplicationCacheKey::UserPasswordChangeSession(UserPasswordChangeSessionInput {
            session_id: session_id.clone(),
        });
    let cache_value =
        ApplicationCacheValue::UserPasswordChangeSession(UserPasswordChangeSessionValue {
            user_id: user.id,
        });

    cache_service::set_key(ss, cache_key, cache_value).await?;
    Ok(session_id)
}

pub async fn set_password_via_session(
    ss: &Arc<SupportingService>,
    session_id: String,
    password: String,
) -> Result<bool> {
    let cache_key =
        ApplicationCacheKey::UserPasswordChangeSession(UserPasswordChangeSessionInput {
            session_id,
        });

    let Some((cache_id, session_data)) =
        cache_service::get_value::<UserPasswordChangeSessionValue>(ss, cache_key.clone()).await
    else {
        bail!("Password change session not found or expired");
    };

    let user = user_by_id(&session_data.user_id, ss).await?;

    let mut user_active = user.into_active_model();
    user_active.password = ActiveValue::Set(Some(password));
    user_active.update(&ss.db).await?;

    cache_service::expire_key(ss, ExpireCacheKeyInput::ById(cache_id)).await?;
    Ok(true)
}

pub async fn get_password_change_url(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: GetPasswordChangeUrlInput,
) -> Result<UserInvitationResponse> {
    if let Some(admin_user_id) = requester_user_id {
        admin_account_guard(&admin_user_id, ss).await?;
    } else if let Some(token) = &input.admin_access_token {
        if token != &ss.config.server.admin_access_token {
            bail!("Invalid admin access token");
        }
    } else {
        bail!("Either user authentication or admin access token is required");
    }

    let user = user_by_id(&input.user_id, ss).await?;
    let session_id = generate_password_change_session(ss, user.id.clone()).await?;
    let password_change_url = build_password_change_url(&ss.config.frontend.url, &session_id);

    Ok(UserInvitationResponse {
        user_id: user.id,
        password_change_url,
    })
}
