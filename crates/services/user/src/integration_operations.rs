use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use database_models::{integration, prelude::Integration};
use database_utils::server_key_validation_guard;
use dependent_core_utils::is_server_key_validated;
use enum_models::{IntegrationLot, IntegrationProvider};
use media_models::CreateOrUpdateUserIntegrationInput;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter, QueryOrder,
};
use supporting_service::SupportingService;

pub async fn delete_user_integration(
    ss: &Arc<SupportingService>,
    user_id: String,
    integration_id: String,
) -> Result<bool> {
    let integration = Integration::find_by_id(integration_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("Integration with the given id does not exist"))?;
    if integration.user_id != user_id {
        bail!("Integration does not belong to the user");
    }
    integration.delete(&ss.db).await?;
    Ok(true)
}

pub async fn create_or_update_user_integration(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateOrUpdateUserIntegrationInput,
) -> Result<bool> {
    let mut lot = ActiveValue::NotSet;
    let mut provider = ActiveValue::NotSet;
    if let Some(p) = input.provider {
        match p {
            IntegrationProvider::JellyfinPush
            | IntegrationProvider::YoutubeMusic
            | IntegrationProvider::RyotBrowserExtension => {
                server_key_validation_guard(is_server_key_validated(ss).await?).await?;
            }
            _ => {}
        }
        let l = match p {
            IntegrationProvider::Komga
            | IntegrationProvider::PlexYank
            | IntegrationProvider::YoutubeMusic
            | IntegrationProvider::Audiobookshelf => IntegrationLot::Yank,
            IntegrationProvider::Radarr
            | IntegrationProvider::Sonarr
            | IntegrationProvider::JellyfinPush => IntegrationLot::Push,
            _ => IntegrationLot::Sink,
        };
        lot = ActiveValue::Set(l);
        provider = ActiveValue::Set(p);
    };
    if input.minimum_progress > input.maximum_progress {
        bail!("Minimum progress cannot be greater than maximum progress");
    }
    let mut to_save = match input.integration_id {
        None => integration::ActiveModel {
            id: ActiveValue::NotSet,
            user_id: ActiveValue::Set(user_id),
            ..Default::default()
        },
        Some(id) => {
            let existing = Integration::find_by_id(&id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Integration with the given id does not exist"))?;
            if existing.user_id != user_id {
                bail!("Integration does not belong to the user");
            }
            existing.into()
        }
    };
    to_save.lot = lot;
    to_save.provider = provider;
    to_save.name = ActiveValue::Set(input.name);
    to_save.is_disabled = ActiveValue::Set(input.is_disabled);
    to_save.extra_settings = ActiveValue::Set(input.extra_settings);
    to_save.minimum_progress = ActiveValue::Set(input.minimum_progress);
    to_save.maximum_progress = ActiveValue::Set(input.maximum_progress);
    to_save.provider_specifics = ActiveValue::Set(input.provider_specifics);
    to_save.sync_to_owned_collection = ActiveValue::Set(input.sync_to_owned_collection);
    to_save.save(&ss.db).await?;
    Ok(true)
}

pub async fn user_integrations(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<Vec<integration::Model>> {
    let integrations = Integration::find()
        .filter(integration::Column::UserId.eq(user_id))
        .order_by_desc(integration::Column::CreatedOn)
        .all(&ss.db)
        .await?;
    Ok(integrations)
}
