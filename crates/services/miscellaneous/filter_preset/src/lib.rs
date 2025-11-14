use std::sync::Arc;

use anyhow::{Result, bail};
use common_models::{CreateOrUpdateFilterPresetInput, FilterContextType};
use database_models::{filter_preset, prelude::FilterPreset};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter};
use supporting_service::SupportingService;

pub async fn get_filter_presets(
    user_id: &str,
    context_type: FilterContextType,
    context_metadata: Option<serde_json::Value>,
    ss: &Arc<SupportingService>,
) -> Result<Vec<filter_preset::Model>> {
    let mut query = FilterPreset::find()
        .filter(filter_preset::Column::UserId.eq(user_id))
        .filter(filter_preset::Column::ContextType.eq(context_type.to_string()));

    if let Some(metadata) = context_metadata {
        query = query.filter(filter_preset::Column::ContextMetadata.eq(metadata));
    } else {
        query = query.filter(filter_preset::Column::ContextMetadata.is_null());
    }

    let presets = query.all(&ss.db).await?;
    Ok(presets)
}

pub async fn create_or_update_filter_preset(
    user_id: &str,
    input: CreateOrUpdateFilterPresetInput,
    ss: &Arc<SupportingService>,
) -> Result<filter_preset::Model> {
    if let Some(id) = input.id {
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
        active_model.updated_at = ActiveValue::Set(chrono::Utc::now());

        let updated = active_model.update(&ss.db).await?;
        Ok(updated)
    } else {
        let existing_with_same_name = FilterPreset::find()
            .filter(filter_preset::Column::UserId.eq(user_id))
            .filter(filter_preset::Column::ContextType.eq(input.context_type.to_string()))
            .filter(filter_preset::Column::Name.eq(&input.name))
            .filter(if input.context_metadata.is_some() {
                filter_preset::Column::ContextMetadata.eq(input.context_metadata.clone())
            } else {
                filter_preset::Column::ContextMetadata.is_null()
            })
            .one(&ss.db)
            .await?;

        if existing_with_same_name.is_some() {
            bail!("A filter preset with this name already exists in this context");
        }

        let new_preset = filter_preset::ActiveModel {
            user_id: ActiveValue::Set(user_id.to_string()),
            name: ActiveValue::Set(input.name),
            context_type: ActiveValue::Set(input.context_type.to_string()),
            context_metadata: ActiveValue::Set(input.context_metadata),
            filters: ActiveValue::Set(input.filters),
            ..Default::default()
        };

        let inserted = new_preset.insert(&ss.db).await?;
        Ok(inserted)
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

    Ok(true)
}
