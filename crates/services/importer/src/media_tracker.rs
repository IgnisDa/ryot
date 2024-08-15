use async_graphql::Result;
use common_models::IdObject;
use common_utils::USER_AGENT_STR;
use dependent_models::ImportResult;
use enums::{ImportSource, MediaLot, MediaSource};
use media_models::{
    CreateOrUpdateCollectionInput, DeployUrlAndKeyImportInput, ImportOrExportItemRating,
    ImportOrExportItemReview, ImportOrExportMediaItemSeen,
};
use providers::openlibrary::get_key;
use reqwest::{
    header::{HeaderMap, HeaderValue, USER_AGENT},
    ClientBuilder,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};

use super::{ImportFailStep, ImportFailedItem, ImportOrExportMediaItem};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum MediaType {
    Book,
    Movie,
    Tv,
    VideoGame,
    Audiobook,
}

impl From<MediaType> for MediaLot {
    fn from(value: MediaType) -> Self {
        match value {
            MediaType::Book => Self::Book,
            MediaType::Movie => Self::Movie,
            MediaType::Tv => Self::Show,
            MediaType::VideoGame => Self::VideoGame,
            MediaType::Audiobook => Self::AudioBook,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ListPrivacy {
    Private,
    Public,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListResponse {
    id: i32,
    name: String,
    #[serde(default)]
    items: Vec<ListItemResponse>,
    description: Option<String>,
    privacy: ListPrivacy,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListItemResponse {
    media_item: Item,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Item {
    id: i32,
    media_type: Option<MediaType>,
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemReview {
    id: i32,
    #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
    date: Option<DateTimeUtc>,
    rating: Option<Decimal>,
    review: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemEpisode {
    id: i32,
    season_number: i32,
    episode_number: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemSeason {
    episodes: Vec<ItemEpisode>,
}

#[serde_as]
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemSeen {
    id: i32,
    #[serde_as(as = "Option<TimestampMilliSeconds<i64, Flexible>>")]
    date: Option<DateTimeUtc>,
    episode_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemDetails {
    id: i32,
    seen_history: Vec<ItemSeen>,
    seasons: Vec<ItemSeason>,
    user_rating: Option<ItemReview>,
    audible_id: Option<String>,
    igdb_id: Option<i32>,
    tmdb_id: Option<i32>,
    openlibrary_id: Option<String>,
    goodreads_id: Option<i32>,
}

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
    let api_url = input.api_url.trim_end_matches('/');
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
    headers.insert("Access-Token", input.api_key.parse().unwrap());
    let client = ClientBuilder::new()
        .default_headers(headers)
        .base_url(format!("{}/api/", api_url))
        .build()
        .unwrap();

    let rsp = client.get("user").send().await.unwrap();
    let data = rsp.json::<IdObject>().await.unwrap();

    let user_id: i32 = data.id;

    let rsp = client
        .get("lists")
        .query(&serde_json::json!({ "userId": user_id }))
        .send()
        .await
        .unwrap();
    let mut lists: Vec<ListResponse> = rsp.json().await.unwrap();

    let collections = lists
        .iter()
        .map(|l| CreateOrUpdateCollectionInput {
            name: l.name.clone(),
            description: l.description.as_ref().and_then(|s| match s.as_str() {
                "" => None,
                x => Some(x.to_owned()),
            }),
            ..Default::default()
        })
        .collect();
    for list in lists.iter_mut() {
        let rsp = client
            .get("list/items")
            .query(&serde_json::json!({ "listId": list.id }))
            .send()
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.json().await.unwrap();
        list.items = items;
    }

    let mut failed_items = vec![];

    // all items returned here are seen at least once
    let rsp = client.get("items").send().await.unwrap();
    let mut data: Vec<Item> = rsp.json().await.unwrap();

    // There are a few items that are added to lists but have not been seen, so will
    // add them manually.
    lists.iter().for_each(|l| {
        l.items.iter().for_each(|i| {
            data.push(Item {
                id: i.media_item.id,
                media_type: i.media_item.media_type.clone(),
            })
        })
    });

    tracing::debug!("Loaded data for {total:?} lists", total = lists.len());

    let data_len = data.len();

    let mut final_data = vec![];
    for (idx, d) in data.into_iter().enumerate() {
        let media_type = match d.media_type {
            Some(m) => m.clone(),
            None => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: d.id.to_string(),
                    error: Some("No media type".to_string()),
                });
                continue;
            }
        };
        let lot = MediaLot::from(media_type.clone());
        let rsp = client
            .get(format!("details/{}", d.id))
            .send()
            .await
            .unwrap();
        let details: ItemDetails = match rsp.json().await {
            Ok(s) => s,
            Err(e) => {
                tracing::error!("Encountered error for id = {id:?}: {e:?}", id = d.id);
                failed_items.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: d.id.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let (identifier, source) = match media_type {
            MediaType::Book => {
                if let Some(_g_id) = details.goodreads_id {
                    failed_items.push(ImportFailedItem {
                        lot: Some(lot),
                        step: ImportFailStep::ItemDetailsFromSource,
                        identifier: d.id.to_string(),
                        error: Some("Goodreads ID not supported".to_string()),
                    });
                    continue;
                } else {
                    (
                        get_key(&details.openlibrary_id.clone().unwrap()),
                        MediaSource::Openlibrary,
                    )
                }
            }
            MediaType::Movie => (details.tmdb_id.unwrap().to_string(), MediaSource::Tmdb),
            MediaType::Tv => (details.tmdb_id.unwrap().to_string(), MediaSource::Tmdb),
            MediaType::VideoGame => (details.igdb_id.unwrap().to_string(), MediaSource::Igdb),
            MediaType::Audiobook => (details.audible_id.clone().unwrap(), MediaSource::Audible),
        };
        tracing::debug!(
            "Got details for {type:?}, with {seen} seen history: {id} ({idx}/{total})",
            type = media_type,
            id = d.id,
            idx = idx,
            total = data_len,
            seen = details.seen_history.len()
        );

        let mut collections = vec![];
        for list in lists.iter() {
            for item in list.items.iter() {
                if item.media_item.id == d.id {
                    collections.push(list.name.clone());
                }
            }
        }

        let item = ImportOrExportMediaItem {
            source_id: d.id.to_string(),
            source,
            lot,
            collections,
            identifier,
            reviews: Vec::from_iter(details.user_rating.map(|r| {
                let review = if let Some(_s) = r.clone().review {
                    Some(ImportOrExportItemReview {
                        date: r.date,
                        spoiler: Some(false),
                        text: r.review,
                        visibility: None,
                    })
                } else {
                    None
                };
                ImportOrExportItemRating {
                    review,
                    rating: r.rating.map(|d| d.saturating_mul(dec!(20))),
                    ..Default::default()
                }
            })),
            seen_history: details
                .seen_history
                .iter()
                .map(|s| {
                    let (season_number, episode_number) = if let Some(c) = s.episode_id {
                        let episode = details
                            .seasons
                            .iter()
                            .flat_map(|e| e.episodes.to_owned())
                            .find(|e| e.id == c)
                            .unwrap();
                        (Some(episode.season_number), Some(episode.episode_number))
                    } else {
                        (None, None)
                    };
                    ImportOrExportMediaItemSeen {
                        ended_on: s.date.map(|d| d.date_naive()),
                        show_season_number: season_number,
                        show_episode_number: episode_number,
                        provider_watched_on: Some(ImportSource::MediaTracker.to_string()),
                        ..Default::default()
                    }
                })
                .collect(),
        };
        final_data.push(item);
    }
    Ok(ImportResult {
        media: final_data,
        failed_items,
        collections,
        ..Default::default()
    })
}
