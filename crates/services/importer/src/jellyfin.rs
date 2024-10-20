use async_graphql::Result;
use common_utils::ryot_log;
use dependent_models::ImportResult;
use enum_meta::HashMap;
use enums::{MediaLot, MediaSource};
use external_utils::jellyfin::{get_authenticated_client, ItemResponse, ItemsResponse, MediaType};
use media_models::{
    DeployUrlAndKeyAndUsernameImportInput, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
};
use serde_json::json;

use super::{ImportFailStep, ImportFailedItem};

pub async fn import(input: DeployUrlAndKeyAndUsernameImportInput) -> Result<ImportResult> {
    let mut to_handle_media = vec![];
    let mut failed_items = vec![];

    let base_url = input.api_url;
    let (client, user_id) =
        get_authenticated_client(&base_url, input.username, input.password).await?;

    let query = json!({ "recursive": true, "IsPlayed": true, "fields": "ProviderIds" });
    let library_data = client
        .get(&format!("{}/Users/{}/Items", base_url, user_id))
        .query(&query)
        .send()
        .await
        .unwrap()
        .json::<ItemsResponse>()
        .await
        .unwrap();

    let mut series_id_to_tmdb_id: HashMap<String, Option<String>> = HashMap::new();

    for item in library_data.items {
        let type_ = item.type_.clone().unwrap();
        ryot_log!(debug, "Processing item: {:?} ({:?})", item.name, type_);
        let (lot, tmdb_id, ssn, sen) = match type_.clone() {
            MediaType::Movie => (MediaLot::Movie, item.provider_ids.unwrap().tmdb, None, None),
            MediaType::Series | MediaType::Episode => {
                if let Some(series_id) = item.series_id {
                    let mut tmdb_id = series_id_to_tmdb_id.get(&series_id).cloned().flatten();
                    if tmdb_id.is_none() {
                        let details = client
                            .get(&format!("{}/Items/{}", base_url, series_id))
                            .send()
                            .await
                            .unwrap()
                            .json::<ItemResponse>()
                            .await
                            .unwrap();
                        let insert_id = details.provider_ids.unwrap().tmdb;
                        series_id_to_tmdb_id.insert(series_id.clone(), insert_id.clone());
                        tmdb_id = insert_id;
                    }
                    (
                        MediaLot::Show,
                        tmdb_id,
                        item.parent_index_number,
                        item.index_number,
                    )
                } else {
                    continue;
                }
            }
            _ => {
                failed_items.push(ImportFailedItem {
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: item.name,
                    error: Some(format!("Unknown media type: {:?}", type_)),
                    lot: None,
                });
                continue;
            }
        };
        if let Some(tmdb_id) = tmdb_id {
            let item_user_data = item.user_data.unwrap();
            let seen = ImportOrExportMediaItemSeen {
                show_season_number: ssn,
                show_episode_number: sen,
                ended_on: item_user_data.last_played_date.map(|d| d.date_naive()),
                ..Default::default()
            };
            let mut collections = vec![];
            if let Some(true) = item_user_data.is_favorite {
                collections.push("Favorites".to_string());
            }
            to_handle_media.push(ImportOrExportMediaItem {
                lot,
                source_id: item.series_name.unwrap_or(item.name),
                source: MediaSource::Tmdb,
                seen_history: vec![seen],
                identifier: tmdb_id,
                collections,
                ..Default::default()
            });
        } else {
            failed_items.push(ImportFailedItem {
                step: ImportFailStep::ItemDetailsFromSource,
                identifier: item.name,
                error: Some("No tmdb id found".to_string()),
                lot: None,
            });
        }
    }

    let mut media: Vec<ImportOrExportMediaItem> = vec![];

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
        metadata: media,
        failed_items,
        ..Default::default()
    })
}
