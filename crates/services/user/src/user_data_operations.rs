use std::sync::Arc;

use anyhow::Result;
use database_models::{
    access_link, integration, notification_platform,
    prelude::{AccessLink, Integration, NotificationPlatform, User},
    user,
};
use database_utils::{get_enabled_users_query, ilike_sql};
use dependent_models::BasicUserDetails;
use sea_orm::{
    ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QueryTrait, prelude::Expr,
    sea_query::extension::postgres::PgExpr,
};
use supporting_service::SupportingService;

pub async fn user_access_links(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<Vec<access_link::Model>> {
    let links = AccessLink::find()
        .filter(access_link::Column::UserId.eq(user_id))
        .order_by_desc(access_link::Column::CreatedOn)
        .all(&ss.db)
        .await?;
    Ok(links)
}

pub async fn users_list(
    ss: &Arc<SupportingService>,
    query: Option<String>,
) -> Result<Vec<BasicUserDetails>> {
    let users = User::find()
        .apply_if(query, |query, value| {
            query.filter(
                Expr::col(user::Column::Name)
                    .ilike(ilike_sql(&value))
                    .or(Expr::col(user::Column::Id).ilike(ilike_sql(&value))),
            )
        })
        .order_by_asc(user::Column::Name)
        .all(&ss.db)
        .await?;
    let users = users
        .into_iter()
        .map(|user| BasicUserDetails {
            id: user.id,
            lot: user.lot,
            name: user.name,
            is_disabled: user.is_disabled,
        })
        .collect();
    Ok(users)
}

pub async fn user_integrations(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<Vec<integration::Model>> {
    let integrations = Integration::find()
        .filter(integration::Column::UserId.eq(user_id))
        .order_by_desc(integration::Column::CreatedOn)
        .all(&ss.db)
        .await?;
    Ok(integrations)
}

pub async fn user_notification_platforms(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<Vec<notification_platform::Model>> {
    let all_notifications = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .all(&ss.db)
        .await?;
    Ok(all_notifications)
}

pub async fn user_by_oidc_issuer_id(
    ss: &Arc<SupportingService>,
    oidc_issuer_id: String,
) -> Result<Option<String>> {
    let user = get_enabled_users_query()
        .filter(user::Column::OidcIssuerId.eq(oidc_issuer_id))
        .one(&ss.db)
        .await?
        .map(|u| u.id);
    Ok(user)
}
