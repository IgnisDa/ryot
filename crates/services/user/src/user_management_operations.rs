use std::sync::Arc;

use async_graphql::{Error, Result};
use common_models::StringIdObject;
use database_models::{prelude::User, user};
use database_utils::admin_account_guard;
use enum_models::UserLot;
use itertools::Itertools;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, ModelTrait};
use supporting_service::SupportingService;
use user_models::UpdateUserInput;

pub async fn update_user(
    supporting_service: &Arc<SupportingService>,
    user_id: Option<String>,
    input: UpdateUserInput,
) -> Result<StringIdObject> {
    if user_id.unwrap_or_default() != input.user_id
        && input.admin_access_token.unwrap_or_default()
            != supporting_service.config.server.admin_access_token
    {
        return Err(Error::new("Admin access token mismatch".to_owned()));
    }
    let mut user_obj: user::ActiveModel = User::find_by_id(input.user_id)
        .one(&supporting_service.db)
        .await
        .unwrap()
        .unwrap()
        .into();
    if let Some(n) = input.username {
        user_obj.name = ActiveValue::Set(n);
    }
    if let Some(p) = input.password {
        user_obj.password = ActiveValue::Set(Some(p));
    }
    if let Some(l) = input.lot {
        user_obj.lot = ActiveValue::Set(l);
    }
    if let Some(d) = input.is_disabled {
        user_obj.is_disabled = ActiveValue::Set(Some(d));
    }
    let user_obj = user_obj.update(&supporting_service.db).await.unwrap();
    Ok(StringIdObject { id: user_obj.id })
}

pub async fn delete_user(
    supporting_service: &Arc<SupportingService>,
    admin_user_id: String,
    to_delete_user_id: String,
) -> Result<bool> {
    admin_account_guard(&admin_user_id, supporting_service).await?;
    let maybe_user = User::find_by_id(to_delete_user_id)
        .one(&supporting_service.db)
        .await?;
    let Some(u) = maybe_user else {
        return Ok(false);
    };
    if crate::user_data_operations::users_list(supporting_service, None)
        .await?
        .into_iter()
        .filter(|u| u.lot == UserLot::Admin)
        .collect_vec()
        .len()
        == 1
        && u.lot == UserLot::Admin
    {
        return Ok(false);
    }
    u.delete(&supporting_service.db).await?;
    Ok(true)
}
