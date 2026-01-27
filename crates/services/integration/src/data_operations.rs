use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use common_utils::ryot_log;
use database_models::{
    integration,
    prelude::{Integration, User},
    user,
};
use database_utils::{server_key_validation_guard, user_by_id};
use dependent_core_utils::is_server_key_validated;
use dependent_provider_utils::{
    get_google_books_service, get_hardcover_service, get_openlibrary_service,
};
use enum_models::{IntegrationLot, IntegrationProvider};
use futures::try_join;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;
use traits::TraceOk;

use crate::{
    integration_operations::{select_integrations_to_process, set_trigger_result},
    webhook_handler::integration_progress_update,
    yank,
};

pub async fn yank_integrations_data_for_user(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<()> {
    let preferences = user_by_id(user_id, ss).await?.preferences;
    if preferences.general.disable_integrations {
        return Ok(());
    }
    let integrations =
        select_integrations_to_process(ss, user_id, IntegrationLot::Yank, None).await?;
    let mut progress_updates = vec![];
    for integration in integrations.into_iter() {
        let specifics = integration.clone().provider_specifics.unwrap();
        let response = match integration.provider {
            IntegrationProvider::Audiobookshelf => {
                let (hardcover, google_books, openlibrary) = try_join!(
                    get_hardcover_service(&ss.config),
                    get_google_books_service(&ss.config),
                    get_openlibrary_service(&ss.config)
                )?;
                yank::audiobookshelf::yank_progress(
                    specifics.audiobookshelf_base_url.unwrap(),
                    specifics.audiobookshelf_token.unwrap(),
                    ss,
                    &hardcover,
                    &google_books,
                    &openlibrary,
                )
                .await
            }
            IntegrationProvider::Komga => {
                yank::komga::yank_progress(
                    specifics.komga_base_url.unwrap(),
                    specifics.komga_api_key.unwrap(),
                    specifics.komga_provider.unwrap(),
                    ss,
                )
                .await
            }
            IntegrationProvider::YoutubeMusic => {
                server_key_validation_guard(is_server_key_validated(ss).await?).await?;
                yank::youtube_music::yank_progress(
                    user_id,
                    specifics.youtube_music_timezone.unwrap(),
                    specifics.youtube_music_auth_cookie.unwrap(),
                    ss,
                )
                .await
            }
            _ => continue,
        };
        match response {
            Ok(update) => progress_updates.push((integration, update)),
            Err(e) => {
                set_trigger_result(ss, Some(e.to_string()), &integration).await?;
            }
        };
    }
    for (integration, progress_updates) in progress_updates.into_iter() {
        integration_progress_update(ss, integration, progress_updates)
            .await
            .trace_ok();
    }
    Ok(())
}

pub async fn yank_integrations_data(ss: &Arc<SupportingService>) -> Result<()> {
    let users_with_integrations = Integration::find()
        .inner_join(User)
        .filter(integration::Column::Lot.eq(IntegrationLot::Yank))
        .filter(
            user::Column::IsDisabled
                .eq(false)
                .or(user::Column::IsDisabled.is_null()),
        )
        .select_only()
        .column(integration::Column::UserId)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?
        .into_iter()
        .collect::<HashSet<String>>();
    for user_id in users_with_integrations {
        ryot_log!(debug, "Yanking integrations data for user {}", user_id);
        yank_integrations_data_for_user(ss, &user_id).await?;
    }
    Ok(())
}

async fn sync_integrations_data_to_owned_collection_for_user(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<()> {
    let preferences = user_by_id(user_id, ss).await?.preferences;
    if preferences.general.disable_integrations {
        return Ok(());
    }
    let integrations =
        select_integrations_to_process(ss, user_id, IntegrationLot::Yank, None).await?;
    let mut progress_updates = vec![];
    for integration in integrations.into_iter() {
        if !integration.sync_to_owned_collection.unwrap_or_default() {
            continue;
        }
        let specifics = integration.clone().provider_specifics.unwrap();
        let response = match integration.provider {
            IntegrationProvider::Audiobookshelf => {
                let (hardcover, google_books, openlibrary) = try_join!(
                    get_hardcover_service(&ss.config),
                    get_google_books_service(&ss.config),
                    get_openlibrary_service(&ss.config)
                )?;
                yank::audiobookshelf::sync_to_owned_collection(
                    specifics.audiobookshelf_base_url.unwrap(),
                    &hardcover,
                    &google_books,
                    &openlibrary,
                )
                .await
            }
            IntegrationProvider::Komga => {
                yank::komga::sync_to_owned_collection(
                    specifics.komga_base_url.unwrap(),
                    specifics.komga_api_key.unwrap(),
                    specifics.komga_provider.unwrap(),
                    ss,
                )
                .await
            }
            IntegrationProvider::PlexYank => {
                yank::plex::sync_to_owned_collection(
                    specifics.plex_yank_base_url.unwrap(),
                    specifics.plex_yank_token.unwrap(),
                )
                .await
            }
            _ => continue,
        };
        match response {
            Ok(update) => progress_updates.push((integration, update)),
            Err(e) => {
                set_trigger_result(ss, Some(e.to_string()), &integration).await?;
            }
        };
    }
    for (integration, progress_updates) in progress_updates.into_iter() {
        integration_progress_update(ss, integration, progress_updates)
            .await
            .trace_ok();
    }
    Ok(())
}

async fn sync_integrations_data_to_owned_collection(ss: &Arc<SupportingService>) -> Result<()> {
    let users_with_integrations = Integration::find()
        .inner_join(User)
        .filter(integration::Column::SyncToOwnedCollection.eq(true))
        .filter(
            user::Column::IsDisabled
                .eq(false)
                .or(user::Column::IsDisabled.is_null()),
        )
        .select_only()
        .column(integration::Column::UserId)
        .into_tuple::<String>()
        .all(&ss.db)
        .await?
        .into_iter()
        .collect::<HashSet<String>>();
    for user_id in users_with_integrations {
        ryot_log!(debug, "Syncing data to owned for user {}", user_id);
        sync_integrations_data_to_owned_collection_for_user(ss, &user_id).await?;
    }
    Ok(())
}

pub async fn sync_user_integrations_data(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<()> {
    sync_integrations_data_to_owned_collection_for_user(ss, user_id).await?;
    yank_integrations_data_for_user(ss, user_id).await?;
    Ok(())
}

pub async fn sync_integrations_data(ss: &Arc<SupportingService>) -> Result<()> {
    try_join!(
        yank_integrations_data(ss),
        sync_integrations_data_to_owned_collection(ss)
    )?;
    Ok(())
}
