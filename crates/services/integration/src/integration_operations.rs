use std::{collections::VecDeque, sync::Arc};

use anyhow::Result;
use chrono::Utc;
use database_models::{integration, prelude::Integration};
use dependent_notification_utils::send_notification_for_user;
use enum_models::{IntegrationLot, IntegrationProvider, UserNotificationContent};
use media_models::IntegrationTriggerResult;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QueryTrait, prelude::DateTimeUtc,
};
use supporting_service::SupportingService;
use traits::TraceOk;

static MAX_ERRORS_BEFORE_DISABLE: usize = 5;

pub async fn set_trigger_result(
    ss: &Arc<SupportingService>,
    error: Option<String>,
    integration: &integration::Model,
) -> Result<()> {
    set_trigger_result_with_partial_success(ss, error, integration, false).await
}

pub async fn set_trigger_result_with_partial_success(
    ss: &Arc<SupportingService>,
    error: Option<String>,
    integration: &integration::Model,
    partial_success: bool,
) -> Result<()> {
    let finished_at = Utc::now();
    let last_success = match error.is_none() || partial_success {
        true => Some(finished_at),
        false => integration.last_finished_at,
    };
    let mut new_trigger_result = VecDeque::from(integration.trigger_result.clone());
    if new_trigger_result.len() >= 20 {
        new_trigger_result.pop_back();
    }
    new_trigger_result.push_front(IntegrationTriggerResult { error, finished_at });
    let should_disable = integration.extra_settings.disable_on_continuous_errors
        && has_continuous_errors(&new_trigger_result, last_success);

    let mut integration = integration.clone().into_active_model();
    integration.last_finished_at = ActiveValue::Set(last_success);
    integration.trigger_result = ActiveValue::Set(new_trigger_result.into());

    if should_disable {
        integration.is_disabled = ActiveValue::Set(Some(true));
    }

    let integration = integration.update(&ss.db).await?;

    if should_disable {
        send_notification_for_user(
            &integration.user_id,
            ss,
            UserNotificationContent::IntegrationDisabledDueToTooManyErrors {
                provider_name: integration.provider.to_string(),
            },
        )
        .await
        .trace_ok();
    }
    Ok(())
}

pub async fn select_integrations_to_process(
    ss: &Arc<SupportingService>,
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
        .all(&ss.db)
        .await?;
    Ok(integrations)
}

fn has_continuous_errors(
    results: &VecDeque<IntegrationTriggerResult>,
    last_success: Option<DateTimeUtc>,
) -> bool {
    results.len() >= MAX_ERRORS_BEFORE_DISABLE
        && results
            .iter()
            .take(MAX_ERRORS_BEFORE_DISABLE)
            .all(|result| {
                result.error.is_some()
                    && last_success.is_none_or(|last_success| {
                        result.finished_at.timestamp_micros() > last_success.timestamp_micros()
                    })
            })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn failures(start: DateTimeUtc, count: i64) -> VecDeque<IntegrationTriggerResult> {
        (1..=count)
            .rev()
            .map(|offset| IntegrationTriggerResult {
                error: Some("Provider lookup failed".into()),
                finished_at: start + Duration::seconds(offset),
            })
            .collect()
    }

    #[test]
    fn five_fully_failed_imports_still_disable_the_integration() {
        let start = Utc::now();
        assert!(!has_continuous_errors(&failures(start, 4), None));
        assert!(has_continuous_errors(&failures(start, 5), None));
        assert!(has_continuous_errors(&failures(start, 5), Some(start)));
    }

    #[test]
    fn partial_success_preserves_errors_but_resets_the_failure_streak() {
        let start = DateTimeUtc::from_timestamp(1_800_000_000, 123_456_789).unwrap();
        let partial_success =
            DateTimeUtc::from_timestamp_micros((start + Duration::seconds(5)).timestamp_micros())
                .unwrap();
        let mut results = failures(start, 5);
        assert!(!has_continuous_errors(&results, Some(partial_success)));
        results = failures(start, 9);
        assert!(!has_continuous_errors(&results, Some(partial_success)));
        results = failures(start, 10);
        assert!(has_continuous_errors(&results, Some(partial_success)));
        assert!(results.iter().all(|result| result.error.is_some()));
    }
}
