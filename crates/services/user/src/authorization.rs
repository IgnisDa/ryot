use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use database_models::{application_cache, prelude::ApplicationCache};
use database_utils::admin_account_guard;
use ring::digest::{SHA256, digest};
use sea_orm::{ActiveValue, ConnectionTrait, EntityTrait, QueryFilter, sea_query::Expr};
use subtle::ConstantTimeEq;
use supporting_service::SupportingService;

pub(crate) fn secrets_match(provided: &str, expected: &str) -> bool {
    if provided.is_empty() || expected.is_empty() {
        return false;
    }
    let provided = digest(&SHA256, provided.as_bytes());
    let expected = digest(&SHA256, expected.as_bytes());
    provided.as_ref().ct_eq(expected.as_ref()).into()
}

pub(crate) async fn can_manage_users(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<&String>,
    token: Option<&str>,
) -> Result<bool> {
    if token.is_some_and(|token| secrets_match(token, &ss.config.server.admin_access_token)) {
        return Ok(true);
    }
    match requester_user_id {
        Some(user_id) => Ok(admin_account_guard(user_id, ss).await.is_ok()),
        None => Ok(false),
    }
}

pub(crate) async fn revoke_user_credentials<C: ConnectionTrait>(
    db: &C,
    user_id: &str,
) -> Result<()> {
    ApplicationCache::update_many()
        .filter(Expr::cust_with_values(
            "value -> 'UserSession' ->> 'user_id' = $1 OR value -> 'UserPasswordChangeSession' ->> 'user_id' = $1",
            [user_id],
        ))
        .set(application_cache::ActiveModel {
            expires_at: ActiveValue::Set(Utc::now()),
            ..Default::default()
        })
        .exec(db)
        .await?;
    Ok(())
}
