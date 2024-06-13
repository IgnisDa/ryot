use async_graphql::Result;
use database::{MediaLot, MediaSource};
use enum_meta::HashMap;
use itertools::Itertools;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::{
    http::headers::{ACCEPT, USER_AGENT},
    Client, Config, Url,
};

use crate::{
    importer::{
        DeployUrlAndKeyAndUsernameImportInput, ImportFailStep, ImportFailedItem, ImportResult,
    },
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    utils::USER_AGENT_STR,
};

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum CollectionType {
    Movies,
    Tvshows,
    #[serde(untagged)]
    Unknown(String),
}

#[derive(Debug, Serialize, Deserialize, Clone, Eq, PartialEq)]
enum MediaType {
    Movie,
    Series,
    Episode,
    #[serde(untagged)]
    Unknown(String),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemProviderIdsPayload {
    tmdb: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemUserData {
    play_count: Option<i32>,
    last_played_date: Option<DateTimeUtc>,
    is_favorite: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemResponse {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    typ: Option<MediaType>,
    index_number: Option<i32>,
    series_id: Option<String>,
    series_name: Option<String>,
    user_data: Option<ItemUserData>,
    parent_index_number: Option<i32>,
    collection_type: Option<CollectionType>,
    provider_ids: Option<ItemProviderIdsPayload>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemsResponse {
    items: Vec<ItemResponse>,
}

pub async fn import(input: DeployUrlAndKeyAndUsernameImportInput) -> Result<ImportResult> {
    let mut to_handle_media = vec![];
    let mut failed_items = vec![];
    let client: Client = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap()
        .add_header(ACCEPT, "application/json")
        .unwrap()
        .add_header("X-Emby-Token", input.password)
        .unwrap()
        .set_base_url(Url::parse(&input.api_url).unwrap().join("/").unwrap())
        .try_into()
        .unwrap();

    let users_data: Vec<ItemResponse> = client
        .get("Users")
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();
    let user_id = users_data
        .into_iter()
        .find(|x| x.name == input.username)
        .unwrap()
        .id;

    let views_data: ItemsResponse = client
        .get(&format!("Users/{}/Views", user_id))
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();

    let mut series_id_to_tmdb_id: HashMap<String, Option<String>> = HashMap::new();

    for library in views_data.items {
        let collection_type = library.collection_type.unwrap();
        if matches!(collection_type, CollectionType::Unknown(_)) {
            failed_items.push(ImportFailedItem {
                step: ImportFailStep::ItemDetailsFromSource,
                identifier: library.name,
                error: Some(format!("Unknown collection type: {:?}", collection_type)),
                lot: None,
            });
            continue;
        }
        let query = json!({
            "parentId": library.id, "recursive": true,
            "IsPlayed": true, "fields": "ProviderIds"
        });
        let library_data: ItemsResponse = client
            .get(&format!("Users/{}/Items", user_id))
            .query(&query)
            .unwrap()
            .await
            .unwrap()
            .body_json()
            .await
            .unwrap();
        for item in library_data.items {
            let typ = item.typ.clone().unwrap();
            tracing::debug!("Processing item: {:?} ({:?})", item.name, typ);
            let (lot, tmdb_id, ssn, sen) = match typ.clone() {
                MediaType::Movie => (MediaLot::Movie, item.provider_ids.unwrap().tmdb, None, None),
                MediaType::Series | MediaType::Episode => {
                    if let Some(series_id) = item.series_id {
                        let mut tmdb_id = series_id_to_tmdb_id.get(&series_id).cloned().flatten();
                        if tmdb_id.is_none() {
                            let details: ItemResponse = client
                                .get(&format!("Items/{}", series_id))
                                .await
                                .unwrap()
                                .body_json()
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
                        error: Some(format!("Unknown media type: {:?}", typ)),
                        lot: None,
                    });
                    continue;
                }
            };
            if let Some(tmdb_id) = tmdb_id {
                let item_user_data = item.user_data.unwrap();
                let num_times_seen = item_user_data.play_count.unwrap_or(0);
                let mut seen_history = (0..num_times_seen)
                    .map(|_| ImportOrExportMediaItemSeen {
                        show_season_number: ssn,
                        show_episode_number: sen,
                        ..Default::default()
                    })
                    .collect_vec();
                if let Some(last) = seen_history.last_mut() {
                    last.ended_on = item_user_data.last_played_date;
                };
                let mut collections = vec![];
                if let Some(true) = item_user_data.is_favorite {
                    collections.push("Favorites".to_string());
                }
                to_handle_media.push(ImportOrExportMediaItem {
                    lot,
                    source_id: item.series_name.unwrap_or(item.name),
                    source: MediaSource::Tmdb,
                    internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                        tmdb_id.clone(),
                    )),
                    seen_history,
                    identifier: tmdb_id,
                    reviews: vec![],
                    collections,
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
        media,
        failed_items,
        ..Default::default()
    })
}
