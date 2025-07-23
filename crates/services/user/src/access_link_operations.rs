use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_models::StringIdObject;
use database_models::{access_link, prelude::AccessLink, user};
use database_utils::{get_enabled_users_query, server_key_validation_guard};
use jwt_service::sign;
use media_models::{
    CreateAccessLinkInput, ProcessAccessLinkError, ProcessAccessLinkErrorVariant,
    ProcessAccessLinkInput, ProcessAccessLinkResponse, ProcessAccessLinkResult,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter,
};
use supporting_service::SupportingService;

pub async fn create_access_link(
    ss: &Arc<SupportingService>,
    input: CreateAccessLinkInput,
    user_id: String,
) -> Result<StringIdObject> {
    server_key_validation_guard(ss.is_server_key_validated().await?).await?;
    let new_link = access_link::ActiveModel {
        user_id: ActiveValue::Set(user_id),
        name: ActiveValue::Set(input.name),
        expires_on: ActiveValue::Set(input.expires_on),
        redirect_to: ActiveValue::Set(input.redirect_to),
        maximum_uses: ActiveValue::Set(input.maximum_uses),
        is_account_default: ActiveValue::Set(input.is_account_default),
        is_mutation_allowed: ActiveValue::Set(input.is_mutation_allowed),
        ..Default::default()
    };
    let link = new_link.insert(&ss.db).await?;
    Ok(StringIdObject { id: link.id })
}

pub async fn process_access_link(
    ss: &Arc<SupportingService>,
    input: ProcessAccessLinkInput,
) -> Result<ProcessAccessLinkResult> {
    let maybe_link = match input {
        ProcessAccessLinkInput::Id(id) => AccessLink::find_by_id(id).one(&ss.db).await?,
        ProcessAccessLinkInput::Username(username) => {
            let user = get_enabled_users_query()
                .filter(user::Column::Name.eq(username))
                .one(&ss.db)
                .await?;
            match user {
                None => None,
                Some(u) => {
                    u.find_related(AccessLink)
                        .filter(access_link::Column::IsAccountDefault.eq(true))
                        .filter(access_link::Column::IsRevoked.is_null())
                        .one(&ss.db)
                        .await?
                }
            }
        }
    };
    let link = match maybe_link {
        None => {
            return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                error: ProcessAccessLinkErrorVariant::NotFound,
            }));
        }
        Some(l) => l,
    };
    if let Some(expiration_time) = link.expires_on {
        if expiration_time < Utc::now() {
            return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                error: ProcessAccessLinkErrorVariant::Expired,
            }));
        }
    }
    if let Some(max_uses) = link.maximum_uses {
        if link.times_used >= max_uses {
            return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
                error: ProcessAccessLinkErrorVariant::MaximumUsesReached,
            }));
        }
    }
    if let Some(true) = link.is_revoked {
        return Ok(ProcessAccessLinkResult::Error(ProcessAccessLinkError {
            error: ProcessAccessLinkErrorVariant::Revoked,
        }));
    }
    let validity = if let Some(expires) = link.expires_on {
        (expires - Utc::now()).num_days().try_into().unwrap()
    } else {
        ss.config.users.token_valid_for_days
    };
    let api_key = sign(
        link.user_id.clone(),
        &ss.config.users.jwt_secret,
        validity,
        Some(link.id.clone()),
    )?;
    let mut issued_tokens = link.issued_tokens.clone();
    issued_tokens.push(api_key.clone());
    let mut link = link.into_active_model();
    link.issued_tokens = ActiveValue::Set(issued_tokens);
    let link = link.update(&ss.db).await?;
    Ok(ProcessAccessLinkResult::Ok(ProcessAccessLinkResponse {
        api_key,
        token_valid_for_days: validity,
        redirect_to: link.redirect_to,
    }))
}
