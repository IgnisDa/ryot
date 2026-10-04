use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use common_models::{DefaultCollection, StringIdObject};
use common_utils::ryot_log;
use database_models::{prelude::User, user};
use database_utils::{admin_account_guard, deploy_job_to_calculate_user_activities_and_summary};
use dependent_collection_utils::create_or_update_collection;
use dependent_models::ExpireCacheKeyInput;
use enum_meta::Meta;
use enum_models::UserLot;
use media_models::{
    AuthUserInput, CreateOrUpdateCollectionInput, RegisterError, RegisterErrorVariant,
    RegisterResult, RegisterUserInput, UserResetResponse, UserResetResult,
};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, ConnectionTrait, DbBackend, EntityTrait,
    ModelTrait, PaginatorTrait, QueryFilter, Statement, TransactionTrait,
};
use sea_orm::{IntoActiveModel, Iterable};
use supporting_service::SupportingService;
use user_models::{UpdateUserInput, UserPreferences};

use crate::{
    authorization::{can_manage_users, revoke_user_credentials},
    password_change_operations::{build_password_change_url, generate_password_change_session},
    user_data_operations::users_list,
};

pub async fn update_user(
    input: UpdateUserInput,
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
) -> Result<StringIdObject> {
    let is_self_update = requester_user_id.as_ref() == Some(&input.user_id);
    let changes_privileged_fields = input.lot.is_some() || input.is_disabled.is_some();
    if (!is_self_update || changes_privileged_fields)
        && !can_manage_users(
            ss,
            requester_user_id.as_ref(),
            input.admin_access_token.as_deref(),
        )
        .await?
    {
        bail!("Administrator authorization required");
    }
    let db_user = User::find_by_id(input.user_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("User not found"))?;
    let mut extra_information = db_user.extra_information.clone().unwrap_or_default();
    let mut user_obj = db_user.into_active_model();
    if let Some(n) = input.username {
        user_obj.name = ActiveValue::Set(n);
    }
    if let Some(l) = input.lot {
        user_obj.lot = ActiveValue::Set(l);
    }
    if let Some(d) = input.is_disabled {
        user_obj.is_disabled = ActiveValue::Set(Some(d));
    }
    if let Some(p) = input.is_onboarding_tour_completed {
        extra_information.is_onboarding_tour_completed = p;
        user_obj.extra_information = ActiveValue::Set(Some(extra_information));
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
    let admin_count = users_list(&admin_user_id, None, ss)
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
    let txn = ss.db.begin().await?;
    txn.execute(Statement::from_string(
        DbBackend::Postgres,
        "LOCK TABLE \"user\" IN SHARE ROW EXCLUSIVE MODE",
    ))
    .await?;
    let Some(user_to_reset) = User::find_by_id(&to_reset_user_id).one(&txn).await? else {
        bail!("User not found");
    };
    let original_id = user_to_reset.id.clone();
    let is_oidc = user_to_reset.oidc_issuer_id.is_some();
    revoke_user_credentials(&txn, &original_id).await?;
    let replacement = user::ActiveModel {
        id: ActiveValue::Set(original_id.clone()),
        lot: ActiveValue::Set(user_to_reset.lot),
        name: ActiveValue::Set(user_to_reset.name.clone()),
        is_disabled: ActiveValue::Set(user_to_reset.is_disabled),
        oidc_issuer_id: ActiveValue::Set(user_to_reset.oidc_issuer_id.clone()),
        preferences: ActiveValue::Set(UserPreferences::default()),
        ..Default::default()
    };
    user_to_reset.delete(&txn).await?;
    replacement.insert(&txn).await?;
    txn.commit().await?;
    initialize_user(ss, &original_id).await?;
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByUser(original_id.clone())).await?;
    let password_change_url = if is_oidc {
        None
    } else {
        let session_id = generate_password_change_session(ss, original_id.clone()).await?;
        Some(build_password_change_url(
            &ss.config.frontend.url,
            &session_id,
        ))
    };
    Ok(UserResetResult::Ok(UserResetResponse {
        password_change_url,
        user_id: original_id,
    }))
}

pub async fn register_user(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: RegisterUserInput,
) -> Result<RegisterResult> {
    match &input.data {
        AuthUserInput::Oidc(_) => bail!("OIDC registration requires a verified authorization flow"),
        AuthUserInput::Password(_) => {
            if ss.config.users.disable_local_auth {
                bail!("Local authentication is disabled");
            }
        }
    }
    if input.user_id.is_some() {
        bail!("User IDs are generated by the server");
    }
    register_verified_user(ss, requester_user_id, input).await
}

pub(crate) async fn register_verified_user(
    ss: &Arc<SupportingService>,
    requester_user_id: Option<String>,
    input: RegisterUserInput,
) -> Result<RegisterResult> {
    let can_manage = can_manage_users(
        ss,
        requester_user_id.as_ref(),
        input.admin_access_token.as_deref(),
    )
    .await?;
    if (input.lot.is_some() || requester_user_id.is_some()) && !can_manage {
        bail!("Administrator authorization required");
    }
    if let AuthUserInput::Password(data) = &input.data
        && data.password.is_empty()
        && !can_manage
    {
        bail!("Password must not be empty");
    }
    if !ss.config.users.allow_registration && !can_manage {
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
            Some(data.password).filter(|password| !password.is_empty()),
        ),
    };
    let txn = ss.db.begin().await?;
    txn.execute(Statement::from_string(
        DbBackend::Postgres,
        "LOCK TABLE \"user\" IN SHARE ROW EXCLUSIVE MODE",
    ))
    .await?;
    let user_exists = User::find().filter(filter).count(&txn).await?;
    let total_users = User::find().count(&txn).await?;
    if user_exists != 0 {
        txn.rollback().await?;
        return Ok(RegisterResult::Error(RegisterError {
            error: RegisterErrorVariant::IdentifierAlreadyExists,
        }));
    };
    let oidc_issuer_id = match input.data {
        AuthUserInput::Oidc(data) => Some(data.issuer_id),
        AuthUserInput::Password(_) => None,
    };
    let lot = match input.lot {
        Some(specified_lot) => specified_lot,
        None => match total_users == 0 {
            true => UserLot::Admin,
            false => UserLot::Normal,
        },
    };
    let user_id = format!("usr_{}", nanoid!(12));
    let user = user::ActiveModel {
        lot: ActiveValue::Set(lot),
        id: ActiveValue::Set(user_id),
        name: ActiveValue::Set(username),
        password: ActiveValue::Set(password),
        oidc_issuer_id: ActiveValue::Set(oidc_issuer_id),
        preferences: ActiveValue::Set(UserPreferences::default()),
        ..Default::default()
    };
    let user = user.insert(&txn).await?;
    txn.commit().await?;
    ryot_log!(
        debug,
        "User {:?} registered with id {:?}",
        user.name,
        user.id
    );
    initialize_user(ss, &user.id).await?;
    Ok(RegisterResult::Ok(StringIdObject { id: user.id }))
}

async fn initialize_user(ss: &Arc<SupportingService>, user_id: &String) -> Result<()> {
    for col in DefaultCollection::iter() {
        let meta = col.meta().to_owned();
        create_or_update_collection(
            user_id,
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
    deploy_job_to_calculate_user_activities_and_summary(user_id, false, ss).await?;
    Ok(())
}
