use std::{collections::VecDeque, sync::Arc};

use async_graphql::Result;
use chrono::Utc;

use database_models::{integration, prelude::Integration};
use dependent_utils::send_notification_for_user;
use enum_models::{IntegrationLot, IntegrationProvider, UserNotificationContent};
use media_models::IntegrationTriggerResult;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QueryTrait,
};
use supporting_service::SupportingService;
use traits::TraceOk;

static MAX_ERRORS_BEFORE_DISABLE: usize = 5;

pub async fn set_trigger_result(
    service: &Arc<SupportingService>,
    error: Option<String>,
    integration: &integration::Model,
) -> Result<()> {
    let finished_at = Utc::now();
    let last_finished_at = match error {
        Some(_) => ActiveValue::NotSet,
        None => ActiveValue::Set(Some(finished_at)),
    };
    let mut new_trigger_result = VecDeque::from(integration.trigger_result.clone());
    if new_trigger_result.len() >= 20 {
        new_trigger_result.pop_back();
    }
    new_trigger_result.push_front(IntegrationTriggerResult { error, finished_at });
    let are_all_errors = new_trigger_result.len() >= MAX_ERRORS_BEFORE_DISABLE
        && new_trigger_result
            .iter()
            .take(MAX_ERRORS_BEFORE_DISABLE)
            .all(|r| r.error.is_some());

    let should_disable = integration.extra_settings.disable_on_continuous_errors && are_all_errors;

    let mut integration: integration::ActiveModel = integration.clone().into();
    integration.last_finished_at = last_finished_at;
    integration.trigger_result = ActiveValue::Set(new_trigger_result.into());

    if should_disable {
        integration.is_disabled = ActiveValue::Set(Some(true));
    }

    let integration = integration.update(&service.db).await?;

    if should_disable {
        send_notification_for_user(
            &integration.user_id,
            service,
            &(
                format!(
                    "Integration {} has been disabled due to too many errors",
                    integration.provider,
                ),
                UserNotificationContent::IntegrationDisabledDueToTooManyErrors,
            ),
        )
        .await
        .trace_ok();
    }
    Ok(())
}

pub async fn select_integrations_to_process(
    service: &Arc<SupportingService>,
    user_id: &String,
    lot: IntegrationLot,
    provider: Option<IntegrationProvider>,
) -> Result<Vec<integration::Model>> {
    let integrations = Integration::find()
        .filter(integration::Column::Lot.eq(lot))
        .filter(integration::Column::UserId.eq(user_id))
        .filter(
            integration::Column::IsDisabled
                .is_null()
                .or(integration::Column::IsDisabled.eq(false)),
        )
        .apply_if(provider, |query, provider| {
            query.filter(integration::Column::Provider.eq(provider))
        })
        .order_by_asc(integration::Column::CreatedOn)
        .all(&service.db)
        .await?;
    Ok(integrations)
}
