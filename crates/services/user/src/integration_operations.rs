use std::sync::Arc;

use async_graphql::{Error, Result};
use database_models::{integration, prelude::Integration};
use database_utils::server_key_validation_guard;
use enum_models::{IntegrationLot, IntegrationProvider};
use media_models::CreateOrUpdateUserIntegrationInput;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, ModelTrait};
use supporting_service::SupportingService;

pub async fn delete_user_integration(
    ss: &Arc<SupportingService>,
    user_id: String,
    integration_id: String,
) -> Result<bool> {
    let integration = Integration::find_by_id(integration_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Integration with the given id does not exist"))?;
    if integration.user_id != user_id {
        return Err(Error::new("Integration does not belong to the user"));
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
                server_key_validation_guard(ss.is_server_key_validated().await?).await?;
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
        return Err(Error::new(
            "Minimum progress cannot be greater than maximum progress",
        ));
    }
    let id = match input.integration_id {
        None => ActiveValue::NotSet,
        Some(id) => ActiveValue::Set(id),
    };
    let to_insert = integration::ActiveModel {
        id,
        lot,
        provider,
        name: ActiveValue::Set(input.name),
        user_id: ActiveValue::Set(user_id),
        is_disabled: ActiveValue::Set(input.is_disabled),
        extra_settings: ActiveValue::Set(input.extra_settings),
        minimum_progress: ActiveValue::Set(input.minimum_progress),
        maximum_progress: ActiveValue::Set(input.maximum_progress),
        provider_specifics: ActiveValue::Set(input.provider_specifics),
        sync_to_owned_collection: ActiveValue::Set(input.sync_to_owned_collection),
        ..Default::default()
    };
    to_insert.save(&ss.db).await?;
    Ok(true)
}
