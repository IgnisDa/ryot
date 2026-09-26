use std::sync::Arc;

use anyhow::Result;
use database_models::{
    access_link,
    prelude::{AccessLink, User},
    user,
};
use database_utils::{apply_columns_search, get_enabled_users_query, user_by_id};
use dependent_models::BasicUserDetails;
use enum_models::UserLot;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QueryTrait, prelude::Expr};
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
    user_id: &String,
    query: Option<String>,
    ss: &Arc<SupportingService>,
) -> Result<Vec<BasicUserDetails>> {
    let main_user = user_by_id(user_id, ss).await?;
    let users = User::find()
        .apply_if(query, |query, value| {
            apply_columns_search(
                &value,
                query,
                [Expr::col(user::Column::Name), Expr::col(user::Column::Id)],
            )
        })
        .order_by_asc(user::Column::Name)
        .all(&ss.db)
        .await?;
    let users = users
        .into_iter()
        .map(|user| BasicUserDetails {
            lot: user.lot,
            id: user.id.clone(),
            is_disabled: user.is_disabled,
            name: match main_user.lot == UserLot::Admin {
                false => user.id,
                true => user.name,
            },
        })
        .collect();
    Ok(users)
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
