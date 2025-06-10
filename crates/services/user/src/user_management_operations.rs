use std::sync::Arc;

use async_graphql::{Error, Result};
use common_models::{DefaultCollection, StringIdObject};
use common_utils::ryot_log;
use database_models::{prelude::User, user};
use database_utils::{admin_account_guard, deploy_job_to_calculate_user_activities_and_summary};
use dependent_utils::create_or_update_collection;
use enum_meta::Meta;
use enum_models::UserLot;
use itertools::Itertools;
use media_models::{
    AuthUserInput, CreateOrUpdateCollectionInput, RegisterError, RegisterErrorVariant,
    RegisterResult, RegisterUserInput,
};
use nanoid::nanoid;
use sea_orm::Iterable;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter,
};
use supporting_service::SupportingService;
use user_models::UpdateUserInput;
use user_models::UserPreferences;

use crate::user_data_operations;

pub async fn update_user(
    ss: &Arc<SupportingService>,
    user_id: Option<String>,
    input: UpdateUserInput,
) -> Result<StringIdObject> {
    if user_id.unwrap_or_default() != input.user_id
        && input.admin_access_token.unwrap_or_default() != ss.config.server.admin_access_token
    {
        return Err(Error::new("Admin access token mismatch".to_owned()));
    }
    let mut user_obj: user::ActiveModel = User::find_by_id(input.user_id)
        .one(&ss.db)
        .await?
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
    let user_obj = user_obj.update(&ss.db).await?;
    Ok(StringIdObject { id: user_obj.id })
}

pub async fn delete_user(
    ss: &Arc<SupportingService>,
    admin_user_id: String,
    to_delete_user_id: String,
) -> Result<bool> {
    admin_account_guard(&admin_user_id, ss).await?;
    let maybe_user = User::find_by_id(to_delete_user_id).one(&ss.db).await?;
    let Some(u) = maybe_user else {
        return Ok(false);
    };
    if user_data_operations::users_list(ss, None)
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
    u.delete(&ss.db).await?;
    Ok(true)
}

pub async fn register_user(
    ss: &Arc<SupportingService>,
    input: RegisterUserInput,
) -> Result<RegisterResult> {
    if !ss.config.users.allow_registration
        && input.admin_access_token.unwrap_or_default() != ss.config.server.admin_access_token
    {
        return Ok(RegisterResult::Error(RegisterError {
            error: RegisterErrorVariant::Disabled,
        }));
    }
    let (filter, username, password) = match input.data.clone() {
        AuthUserInput::Oidc(data) => (
            user::Column::OidcIssuerId.eq(&data.issuer_id),
            data.email,
            None,
        ),
        AuthUserInput::Password(data) => (
            user::Column::Name.eq(&data.username),
            data.username,
            Some(data.password),
        ),
    };
    if User::find().filter(filter).count(&ss.db).await? != 0 {
        return Ok(RegisterResult::Error(RegisterError {
            error: RegisterErrorVariant::IdentifierAlreadyExists,
        }));
    };
    let oidc_issuer_id = match input.data {
        AuthUserInput::Oidc(data) => Some(data.issuer_id),
        AuthUserInput::Password(_) => None,
    };
    let lot = if User::find().count(&ss.db).await.unwrap() == 0 {
        UserLot::Admin
    } else {
        UserLot::Normal
    };
    let user = user::ActiveModel {
        id: ActiveValue::Set(format!("usr_{}", nanoid!(12))),
        name: ActiveValue::Set(username),
        password: ActiveValue::Set(password),
        oidc_issuer_id: ActiveValue::Set(oidc_issuer_id),
        lot: ActiveValue::Set(lot),
        preferences: ActiveValue::Set(UserPreferences::default()),
        ..Default::default()
    };
    let user = user.insert(&ss.db).await?;
    ryot_log!(
        debug,
        "User {:?} registered with id {:?}",
        user.name,
        user.id
    );
    for col in DefaultCollection::iter() {
        let meta = col.meta().to_owned();
        create_or_update_collection(
            &user.id,
            ss,
            CreateOrUpdateCollectionInput {
                name: col.to_string(),
                information_template: meta.0,
                description: Some(meta.1.to_owned()),
                ..Default::default()
            },
        )
        .await
        .ok();
    }
    deploy_job_to_calculate_user_activities_and_summary(&user.id, false, ss).await?;
    Ok(RegisterResult::Ok(StringIdObject { id: user.id }))
}
