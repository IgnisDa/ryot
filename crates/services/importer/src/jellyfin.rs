use std::{collections::HashMap, result::Result as StdResult, sync::Arc};

use anyhow::Result;
use common_utils::ryot_log;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{MediaLot, MediaSource};
use external_utils::jellyfin::{ItemResponse, ItemsResponse, MediaType, get_authenticated_client};
use futures::stream::{self, StreamExt};
use media_models::{DeployJellyfinImportInput, ImportOrExportMetadataItemSeen};
use reqwest::Client;
use serde_json::json;
use tokio::sync::Mutex;

use crate::{ImportFailStep, ImportFailedItem};

pub async fn import(input: DeployJellyfinImportInput) -> Result<ImportResult> {
    let mut failed = vec![];

    let base_url = input.api_url;
    let (client, user_id) =
        get_authenticated_client(&base_url, &input.username, &input.password).await?;

    let query = json!({ "recursive": true, "IsPlayed": true, "fields": "ProviderIds" });
    let library_data = client
        .get(format!("{base_url}/Users/{user_id}/Items"))
        .query(&query)
        .send()
        .await
        .unwrap()
        .json::<ItemsResponse>()
        .await
        .unwrap();

    let len = library_data.items.len();
    let series_cache = Arc::new(Mutex::new(HashMap::<String, Option<String>>::new()));

    let results: Vec<_> = stream::iter(library_data.items.into_iter().enumerate())
        .map(|(idx, item)| {
            process_item(
                idx,
                item,
                len,
                &client,
                &base_url,
                Arc::clone(&series_cache),
            )
        })
        .buffer_unordered(5)
        .collect()
        .await;

    let mut to_handle_media = vec![];
    for result in results {
        match result {
            Ok(Some(item)) => to_handle_media.push(item),
            Ok(None) => {} // Item was skipped
            Err(error_item) => failed.push(error_item),
        }
    }

    let mut media: Vec<ImportOrExportMetadataItem> = vec![];

    for item in to_handle_media {
        let mut found = false;
        for media_item in media.iter_mut() {
            if media_item.identifier == item.identifier && media_item.lot == item.lot {
                found = true;
                media_item.seen_history.extend(item.seen_history.clone());
                media_item.collections.extend(item.collections.clone());
                break;
            }
        }
        if !found {
            media.push(item);
        }
    }

    Ok(ImportResult {
        failed,
        completed: media
            .into_iter()
            .map(ImportCompletedItem::Metadata)
            .collect(),
    })
}

async fn process_item(
    idx: usize,
    item: external_utils::jellyfin::ItemResponse,
    total: usize,
    client: &Client,
    base_url: &str,
    series_cache: Arc<Mutex<HashMap<String, Option<String>>>>,
) -> StdResult<Option<ImportOrExportMetadataItem>, ImportFailedItem> {
    let typ = item.typ.clone().unwrap();
    ryot_log!(
        debug,
        "Processing item: {:?} ({:?}) ({}/{})",
        item.name,
        typ,
        idx + 1,
        total
    );
    let (lot, tmdb_id, ssn, sen) = match typ.clone() {
        MediaType::Movie => (MediaLot::Movie, item.provider_ids.unwrap().tmdb, None, None),
        MediaType::Series | MediaType::Episode => {
            if let Some(series_id) = item.series_id {
                let cached_tmdb_id = {
                    let cache = series_cache.lock().await;
                    cache.get(&series_id).cloned()
                };

                let tmdb_id = match cached_tmdb_id {
                    Some(cached_id) => cached_id,
                    None => {
                        let details = client
                            .get(format!("{base_url}/Items/{series_id}"))
                            .send()
                            .await
                            .map_err(|e| ImportFailedItem {
                                identifier: item.name.clone(),
                                error: Some(e.to_string()),
                                step: ImportFailStep::ItemDetailsFromSource,
                                ..Default::default()
                            })?
                            .json::<ItemResponse>()
                            .await
                            .map_err(|e| ImportFailedItem {
                                identifier: item.name.clone(),
                                error: Some(e.to_string()),
                                step: ImportFailStep::ItemDetailsFromSource,
                                ..Default::default()
                            })?;
                        let fetched_tmdb_id = details.provider_ids.unwrap().tmdb;

                        {
                            let mut cache = series_cache.lock().await;
                            cache.insert(series_id.clone(), fetched_tmdb_id.clone());
                        }

                        fetched_tmdb_id
                    }
                };

                (
                    MediaLot::Show,
                    tmdb_id,
                    item.parent_index_number,
                    item.index_number,
                )
            } else {
                return Ok(None);
            }
        }
        _ => {
            return Err(ImportFailedItem {
                identifier: item.name,
                step: ImportFailStep::ItemDetailsFromSource,
                error: Some(format!("Unknown media type: {typ:?}")),
                ..Default::default()
            });
        }
    };
    if let Some(tmdb_id) = tmdb_id {
        let item_user_data = item.user_data.unwrap();
        let seen = ImportOrExportMetadataItemSeen {
            show_season_number: ssn,
            show_episode_number: sen,
            ended_on: item_user_data.last_played_date,
            ..Default::default()
        };
        let mut collections = vec![];
        if let Some(true) = item_user_data.is_favorite {
            collections.push("Favorites".to_string());
        }
        let collections = collections
            .into_iter()
            .map(|name| CollectionToEntityDetails {
                collection_name: name,
                ..Default::default()
            })
            .collect();

        Ok(Some(ImportOrExportMetadataItem {
            lot,
            source_id: item.series_name.unwrap_or(item.name),
            source: MediaSource::Tmdb,
            seen_history: vec![seen],
            identifier: tmdb_id,
            collections,
            ..Default::default()
        }))
    } else {
        Err(ImportFailedItem {
            identifier: item.name,
            error: Some("No tmdb id found".to_string()),
            step: ImportFailStep::ItemDetailsFromSource,
            ..Default::default()
        })
    }
}
