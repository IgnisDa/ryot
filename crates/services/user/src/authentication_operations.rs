use std::sync::Arc;

use application_utils::user_id_from_token;
use async_graphql::Result;
use database_utils::{revoke_access_link as db_revoke_access_link, user_by_id};
use dependent_models::UserDetailsResult;
use jwt_service::sign;
use media_models::{UserDetailsError, UserDetailsErrorVariant};
use supporting_service::SupportingService;

pub async fn generate_auth_token(
    supporting_service: &Arc<SupportingService>,
    user_id: String,
) -> Result<String> {
    let auth_token = sign(
        user_id,
        &supporting_service.config.users.jwt_secret,
        supporting_service.config.users.token_valid_for_days,
        None,
    )?;
    Ok(auth_token)
}

pub async fn revoke_access_link(
    supporting_service: &Arc<SupportingService>,
    access_link_id: String,
) -> Result<bool> {
    db_revoke_access_link(&supporting_service.db, access_link_id).await
}

pub async fn user_details(
    supporting_service: &Arc<SupportingService>,
    token: &str,
) -> Result<UserDetailsResult> {
    let found_token = user_id_from_token(token, &supporting_service.config.users.jwt_secret);
    let Ok(user_id) = found_token else {
        return Ok(UserDetailsResult::Error(UserDetailsError {
            error: UserDetailsErrorVariant::AuthTokenInvalid,
        }));
    };
    let user = user_by_id(&user_id, supporting_service).await?;
    Ok(UserDetailsResult::Ok(Box::new(user)))
}
