use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::{DefaultCollection, StringIdObject};
use common_utils::ryot_log;
use database_models::{prelude::User, user};
use database_utils::{admin_account_guard, deploy_job_to_calculate_user_activities_and_summary};
use dependent_collection_utils::create_or_update_collection;
use dependent_models::ExpireCacheKeyInput;
use enum_meta::Meta;
use enum_models::UserLot;
use futures::try_join;
use media_models::{
    AuthUserInput, CreateOrUpdateCollectionInput, OidcUserInput, PasswordUserInput, RegisterError,
    RegisterErrorVariant, RegisterResult, RegisterUserInput, UserResetResponse, UserResetResult,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, PaginatorTrait,
    QueryFilter,
};
use sea_orm::{IntoActiveModel, Iterable};
use supporting_service::SupportingService;
use user_models::UpdateUserInput;
use user_models::UserPreferences;

use crate::{password_change_operations, user_data_operations};

pub async fn update_user(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: UpdateUserInput,
) -> Result<StringIdObject> {
    if let Some(ref uid) = requester_user_id {
        if uid != &input.user_id
            && admin_account_guard(uid, ss).await.is_err()
            && input.admin_access_token.unwrap_or_default() != ss.config.server.admin_access_token
        {
            bail!("Admin access token required".to_owned());
        }
    } else if input.admin_access_token.unwrap_or_default() != ss.config.server.admin_access_token {
        bail!("Admin access token required".to_owned());
    }
    let mut user_obj = User::find_by_id(input.user_id)
        .one(&ss.db)
        .await?
        .unwrap()
        .into_active_model();
    if let Some(n) = input.username {
        user_obj.name = ActiveValue::Set(n);
    }
    if let Some(l) = input.lot {
        user_obj.lot = ActiveValue::Set(l);
    }
    if let Some(d) = input.is_disabled {
        user_obj.is_disabled = ActiveValue::Set(Some(d));
    }
    let user_obj = user_obj.update(&ss.db).await?;
    ryot_log!(debug, "Updated user with id {:?}", user_obj.id);
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
    let admin_count = user_data_operations::users_list(ss, None)
        .await?
        .into_iter()
        .filter(|u| u.lot == UserLot::Admin)
        .count();
    if admin_count == 1 && u.lot == UserLot::Admin {
        return Ok(false);
    }
    u.delete(&ss.db).await?;
    Ok(true)
}

pub async fn reset_user(
    ss: &Arc<SupportingService>,
    admin_user_id: String,
    to_reset_user_id: String,
) -> Result<UserResetResult> {
    admin_account_guard(&admin_user_id, ss).await?;
    let maybe_user = User::find_by_id(&to_reset_user_id).one(&ss.db).await?;
    let Some(user_to_reset) = maybe_user else {
        bail!("User not found");
    };

    let original_id = user_to_reset.id.clone();
    let original_name = user_to_reset.name.clone();
    let original_oidc_issuer_id = user_to_reset.oidc_issuer_id.clone();
    let original_lot = user_to_reset.lot;

    user_to_reset.delete(&ss.db).await?;

    let auth_input = match original_oidc_issuer_id {
        Some(ref issuer_id) => AuthUserInput::Oidc(OidcUserInput {
            email: original_name,
            issuer_id: issuer_id.clone(),
        }),
        None => AuthUserInput::Password(PasswordUserInput {
            username: original_name,
            password: String::new(),
        }),
    };

    let register_input = RegisterUserInput {
        data: auth_input,
        lot: Some(original_lot),
        user_id: Some(original_id.clone()),
        admin_access_token: Some(ss.config.server.admin_access_token.clone()),
    };

    let register_result = register_user(ss, None, register_input).await?;
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByUser(original_id)).await?;
    match register_result {
        RegisterResult::Error(error) => Ok(UserResetResult::Error(error)),
        RegisterResult::Ok(result) => {
            ryot_log!(debug, "User reset with id {:?}", result.id);
            let password_change_url = match original_oidc_issuer_id {
                Some(_) => None,
                None => {
                    let session_id = password_change_operations::generate_password_change_session(
                        ss,
                        result.id.clone(),
                    )
                    .await?;
                    Some(password_change_operations::build_password_change_url(
                        &ss.config.frontend.url,
                        &session_id,
                    ))
                }
            };
            Ok(UserResetResult::Ok(UserResetResponse {
                user_id: result.id,
                password_change_url,
            }))
        }
    }
}

pub async fn register_user(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: RegisterUserInput,
) -> Result<RegisterResult> {
    if let Some(ref uid) = requester_user_id {
        admin_account_guard(uid, ss).await?;
    } else if !ss.config.users.allow_registration
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
    let (user_exists, total_users) = try_join!(
        User::find().filter(filter).count(&ss.db),
        User::find().count(&ss.db)
    )?;
    if user_exists != 0 {
        return Ok(RegisterResult::Error(RegisterError {
            error: RegisterErrorVariant::IdentifierAlreadyExists,
        }));
    };
    let oidc_issuer_id = match input.data {
        AuthUserInput::Oidc(data) => Some(data.issuer_id),
        AuthUserInput::Password(_) => None,
    };
    // TODO: https://github.com/SeaQL/sea-orm/discussions/730#discussioncomment-13440496
    let lot = match input.lot {
        Some(specified_lot) => specified_lot,
        None => match total_users == 0 {
            true => UserLot::Admin,
            false => UserLot::Normal,
        },
    };
    let user_id = input
        .user_id
        .unwrap_or_else(|| format!("usr_{}", nanoid!(12)));
    let user = user::ActiveModel {
        id: ActiveValue::Set(user_id),
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
