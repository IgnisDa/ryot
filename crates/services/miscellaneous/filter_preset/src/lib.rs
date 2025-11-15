use std::sync::Arc;

use anyhow::{Result, bail};
use chrono::Utc;
use common_models::{CreateOrUpdateFilterPresetInput, FilterPresetQueryInput, UserLevelCacheKey};
use database_models::{filter_preset, prelude::FilterPreset};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, FilterPresetsListResponse,
};
use dependent_utility_utils::expire_user_filter_presets_cache;
use nanoid::nanoid;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;

pub async fn get_filter_presets(
    user_id: &str,
    input: FilterPresetQueryInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<FilterPresetsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserFilterPresets(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserFilterPresets,
        || async {
            let mut query = FilterPreset::find()
                .filter(filter_preset::Column::UserId.eq(user_id))
                .filter(filter_preset::Column::ContextType.eq(input.context_type));

            query = match &input.context_metadata {
                None => query.filter(filter_preset::Column::ContextMetadata.is_null()),
                Some(metadata) => {
                    query.filter(filter_preset::Column::ContextMetadata.eq(metadata.clone()))
                }
            };

            let presets = query
                .order_by_desc(filter_preset::Column::LastUsedAt)
                .all(&ss.db)
                .await?;
            Ok(presets)
        },
    )
    .await
}

pub async fn create_or_update_filter_preset(
    user_id: &str,
    input: CreateOrUpdateFilterPresetInput,
    ss: &Arc<SupportingService>,
) -> Result<filter_preset::Model> {
    match input.id {
        Some(id) => {
            let existing = FilterPreset::find_by_id(&id)
                .filter(filter_preset::Column::UserId.eq(user_id))
                .one(&ss.db)
                .await?;

            let Some(existing) = existing else {
                bail!("Filter preset not found or access denied");
            };

            let mut active_model: filter_preset::ActiveModel = existing.into();
            active_model.name = ActiveValue::Set(input.name);
            active_model.filters = ActiveValue::Set(input.filters);
            active_model.updated_at = ActiveValue::Set(Utc::now());

            let updated = active_model.update(&ss.db).await?;

            expire_user_filter_presets_cache(&user_id.to_owned(), ss).await?;

            Ok(updated)
        }
        None => {
            let new_preset = filter_preset::ActiveModel {
                name: ActiveValue::Set(input.name),
                filters: ActiveValue::Set(input.filters),
                last_used_at: ActiveValue::Set(Utc::now()),
                user_id: ActiveValue::Set(user_id.to_string()),
                id: ActiveValue::Set(format!("fp_{}", nanoid!())),
                context_type: ActiveValue::Set(input.context_type),
                context_metadata: ActiveValue::Set(input.context_metadata),
                ..Default::default()
            };

            let inserted = new_preset.insert(&ss.db).await?;

            expire_user_filter_presets_cache(&user_id.to_owned(), ss).await?;

            Ok(inserted)
        }
    }
}

pub async fn delete_filter_preset(
    user_id: &str,
    filter_preset_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let preset = FilterPreset::find_by_id(filter_preset_id)
        .filter(filter_preset::Column::UserId.eq(user_id))
        .one(&ss.db)
        .await?;

    let Some(preset) = preset else {
        bail!("Filter preset not found or access denied");
    };

    let active_model: filter_preset::ActiveModel = preset.into();
    active_model.delete(&ss.db).await?;

    expire_user_filter_presets_cache(&user_id.to_owned(), ss).await?;

    Ok(true)
}

pub async fn update_filter_preset_last_used(
    user_id: &str,
    filter_preset_id: &str,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let preset = FilterPreset::find_by_id(filter_preset_id)
        .filter(filter_preset::Column::UserId.eq(user_id))
        .one(&ss.db)
        .await?;

    let Some(preset) = preset else {
        bail!("Filter preset not found or access denied");
    };

    let mut active_model: filter_preset::ActiveModel = preset.into();
    active_model.last_used_at = ActiveValue::Set(Utc::now());
    active_model.update(&ss.db).await?;

    expire_user_filter_presets_cache(&user_id.to_owned(), ss).await?;

    Ok(true)
}
