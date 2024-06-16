use async_graphql::Result;
use database::{MediaLot, MediaSource};
use enum_meta::HashMap;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use surf::{
    http::headers::{ACCEPT, AUTHORIZATION, USER_AGENT},
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

static EMBY_HEADER_VALUE: &str =
    r#"MediaBrowser , Client="other", Device="script", DeviceId="script", Version="0.0.0""#;

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
    last_played_date: Option<DateTimeUtc>,
    is_favorite: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemResponse {
    id: String,
    name: String,
    #[serde(rename = "Type")]
    type_: Option<MediaType>,
    index_number: Option<i32>,
    series_id: Option<String>,
    series_name: Option<String>,
    user_data: Option<ItemUserData>,
    parent_index_number: Option<i32>,
    provider_ids: Option<ItemProviderIdsPayload>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct ItemsResponse {
    items: Vec<ItemResponse>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "PascalCase")]
struct AuthenticateResponse {
    user: ItemResponse,
    access_token: String,
}

pub async fn import(input: DeployUrlAndKeyAndUsernameImportInput) -> Result<ImportResult> {
    let uri = format!("{}/Users/AuthenticateByName", input.api_url);
    let authenticate: AuthenticateResponse = surf::post(uri)
        .header(AUTHORIZATION, EMBY_HEADER_VALUE)
        .body_json(&serde_json::json!({ "Username": input.username, "Pw": input.password }))
        .unwrap()
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();
    tracing::debug!("Authenticated with token: {}", authenticate.access_token);

    let client: Client = Config::new()
        .add_header(USER_AGENT, USER_AGENT_STR)
        .unwrap()
        .add_header(ACCEPT, "application/json")
        .unwrap()
        .add_header("X-Emby-Token", authenticate.access_token)
        .unwrap()
        .set_base_url(Url::parse(&input.api_url).unwrap().join("/").unwrap())
        .try_into()
        .unwrap();
    let user_id = authenticate.user.id;
    tracing::debug!("Authenticated as user id: {}", user_id);

    let mut to_handle_media = vec![];
    let mut failed_items = vec![];

    let query = json!({ "recursive": true, "IsPlayed": true, "fields": "ProviderIds" });
    let library_data: ItemsResponse = client
        .get(&format!("Users/{}/Items", user_id))
        .query(&query)
        .unwrap()
        .await
        .unwrap()
        .body_json()
        .await
        .unwrap();

    let mut series_id_to_tmdb_id: HashMap<String, Option<String>> = HashMap::new();

    for item in library_data.items {
        let type_ = item.type_.clone().unwrap();
        tracing::debug!("Processing item: {:?} ({:?})", item.name, type_);
        let (lot, tmdb_id, ssn, sen) = match type_.clone() {
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
                internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                    tmdb_id.clone(),
                )),
                seen_history: vec![seen],
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
