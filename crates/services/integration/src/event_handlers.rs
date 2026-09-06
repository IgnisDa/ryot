use std::sync::Arc;

use anyhow::{Result, anyhow};
use database_models::{
    metadata,
    prelude::{CollectionToEntity, Metadata, Seen, UserToEntity},
    seen, user_to_entity,
};
use database_utils::server_key_validation_guard;
use dependent_core_utils::is_server_key_validated;
use dependent_details_utils::metadata_details;
use enum_models::{EntityLot, IntegrationLot, IntegrationProvider, MediaLot};
use media_models::SeenShowExtraInformation;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;
use uuid::Uuid;

use crate::{
    integration_operations::{select_integrations_to_process, set_trigger_result},
    push,
    utils::{ArrPushConfig, ArrPushConfigExternalId},
};

pub async fn handle_entity_added_to_collection_event(
    ss: &Arc<SupportingService>,
    collection_to_entity_id: Uuid,
) -> Result<()> {
    let cte = CollectionToEntity::find_by_id(collection_to_entity_id)
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Collection to entity does not exist"))?;
    if !matches!(cte.entity_lot, EntityLot::Metadata) {
        return Ok(());
    }
    let users = UserToEntity::find()
        .select_only()
        .column(user_to_entity::Column::UserId)
        .filter(user_to_entity::Column::CollectionId.eq(&cte.collection_id))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    for user_id in users {
        let integrations =
            select_integrations_to_process(ss, &user_id, IntegrationLot::Push, None).await?;
        for integration in integrations {
            let possible_collection_ids = match integration.provider_specifics.clone() {
                Some(s) => match integration.provider {
                    IntegrationProvider::Radarr => s.radarr_sync_collection_ids.unwrap_or_default(),
                    IntegrationProvider::Sonarr => s.sonarr_sync_collection_ids.unwrap_or_default(),
                    _ => vec![],
                },
                None => vec![],
            };
            if !possible_collection_ids.contains(&cte.collection_id) {
                continue;
            }
            let specifics = integration.provider_specifics.clone().unwrap();
            let metadata = metadata_details(ss, &cte.entity_id).await?.response;
            let maybe_entity_id = match metadata.lot {
                MediaLot::Show => metadata
                    .external_identifiers
                    .and_then(|ei| ei.tvdb_id.map(|i| i.to_string())),
                _ => Some(metadata.identifier.clone()),
            };
            let Some(entity_id) = maybe_entity_id else {
                continue;
            };
            let push_result = match integration.provider {
                IntegrationProvider::Radarr => {
                    push::radarr::push_progress(ArrPushConfig {
                        api_key: specifics.radarr_api_key.unwrap(),
                        profile_id: specifics.radarr_profile_id.unwrap(),
                        external_id: ArrPushConfigExternalId::Tmdb(entity_id),
                        base_url: specifics.radarr_base_url.unwrap(),
                        metadata_lot: metadata.lot,
                        metadata_title: metadata.title,
                        root_folder_path: specifics.radarr_root_folder_path.unwrap(),
                        tag_ids: specifics.radarr_tag_ids.clone(),
                    })
                    .await
                }
                IntegrationProvider::Sonarr => {
                    push::sonarr::push_progress(ArrPushConfig {
                        api_key: specifics.sonarr_api_key.unwrap(),
                        profile_id: specifics.sonarr_profile_id.unwrap(),
                        external_id: ArrPushConfigExternalId::Tvdb(entity_id),
                        base_url: specifics.sonarr_base_url.unwrap(),
                        metadata_lot: metadata.lot,
                        metadata_title: metadata.title,
                        root_folder_path: specifics.sonarr_root_folder_path.unwrap(),
                        tag_ids: specifics.sonarr_tag_ids.clone(),
                    })
                    .await
                }
                _ => unreachable!(),
            };
            set_trigger_result(ss, push_result.err().map(|e| e.to_string()), &integration).await?;
        }
    }
    Ok(())
}

pub async fn handle_on_seen_complete(ss: &Arc<SupportingService>, id: String) -> Result<()> {
    let (user_id, show_extra_information, metadata_title, metadata_lot) = Seen::find_by_id(id)
        .left_join(Metadata)
        .select_only()
        .columns([seen::Column::UserId, seen::Column::ShowExtraInformation])
        .columns([metadata::Column::Title, metadata::Column::Lot])
        .into_tuple::<(String, Option<SeenShowExtraInformation>, String, MediaLot)>()
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Seen with the given ID could not be found"))?;
    let integrations = select_integrations_to_process(
        ss,
        &user_id,
        IntegrationLot::Push,
        Some(IntegrationProvider::JellyfinPush),
    )
    .await?;
    for integration in integrations {
        let specifics = integration.provider_specifics.clone().unwrap();
        let push_result = match integration.provider {
            IntegrationProvider::JellyfinPush => {
                server_key_validation_guard(is_server_key_validated(ss).await?).await?;
                push::jellyfin::push_progress(
                    specifics.jellyfin_push_base_url.unwrap(),
                    specifics.jellyfin_push_username.unwrap(),
                    specifics.jellyfin_push_password,
                    &metadata_lot,
                    &metadata_title,
                    &show_extra_information,
                )
                .await
            }
            _ => unreachable!(),
        };
        set_trigger_result(ss, push_result.err().map(|e| e.to_string()), &integration).await?;
    }
    Ok(())
}
