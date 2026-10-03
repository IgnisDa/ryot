use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::{Duration, Utc};
use common_utils::generate_session_id;
use database_models::prelude::User;
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, UserPasswordChangeSessionValue,
};
use media_models::{GetPasswordChangeSessionInput, GetPasswordChangeSessionResponse};
use sea_orm::{
    ActiveModelTrait, ActiveValue, EntityTrait, IntoActiveModel, QuerySelect, TransactionTrait,
};
use supporting_service::SupportingService;

use crate::authorization::{can_manage_users, revoke_user_credentials};

pub fn build_password_change_url(frontend_url: &str, session_id: &str) -> String {
    format!("{frontend_url}/change-password?sessionId={session_id}")
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
    let cache_key = ApplicationCacheKey::UserPasswordChangeSession(session_id.to_owned());
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
    if password.is_empty() {
        bail!("Password must not be empty");
    }
    let cache_key = ApplicationCacheKey::UserPasswordChangeSession(session_id);

    let Some((_, session_data)) =
        cache_service::get_value::<UserPasswordChangeSessionValue>(ss, cache_key.clone()).await
    else {
        bail!("Password change session not found or expired");
    };

    let txn = ss.db.begin().await?;
    let Some(user) = User::find_by_id(&session_data.user_id)
        .lock_exclusive()
        .one(&txn)
        .await?
    else {
        bail!("User not found");
    };
    let Some((cache, locked_session)) =
        cache_service::get_value_for_update::<UserPasswordChangeSessionValue, _>(&txn, &cache_key)
            .await?
    else {
        bail!("Password change session not found or expired");
    };
    if locked_session.user_id != user.id || cache.created_at + Duration::minutes(30) <= Utc::now() {
        bail!("Password change session not found or expired");
    }
    if user.oidc_issuer_id.is_some() {
        bail!("Password change not available for OIDC users");
    }
    let mut user_active = user.into_active_model();
    user_active.password = ActiveValue::Set(Some(password));
    let user = user_active.update(&txn).await?;
    revoke_user_credentials(&txn, &user.id).await?;
    txn.commit().await?;
    Ok(true)
}

pub async fn get_password_change_session(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: GetPasswordChangeSessionInput,
) -> Result<GetPasswordChangeSessionResponse> {
    if !can_manage_users(
        ss,
        requester_user_id.as_ref(),
        input.admin_access_token.as_deref(),
    )
    .await?
    {
        bail!("Administrator authorization required");
    }

    let user = user_by_id(&input.user_id, ss).await?;
    let session_id = generate_password_change_session(ss, user.id.clone()).await?;
    let password_change_url = build_password_change_url(&ss.config.frontend.url, &session_id);

    Ok(GetPasswordChangeSessionResponse {
        user_id: user.id,
        password_change_url,
    })
}
