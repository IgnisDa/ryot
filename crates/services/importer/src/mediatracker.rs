use async_graphql::Result;
use common_models::IdObject;
use common_utils::{USER_AGENT_STR, ryot_log};
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use futures::stream::{self, StreamExt};
use media_models::{
    CreateOrUpdateCollectionInput, DeployUrlAndKeyImportInput, ImportOrExportItemRating,
    ImportOrExportItemReview, ImportOrExportMetadataItemSeen,
};
use providers::openlibrary::get_key;
use reqwest::{
    ClientBuilder,
    header::{HeaderMap, HeaderValue, USER_AGENT},
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{TimestampMilliSeconds, formats::Flexible, serde_as};

use super::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

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

async fn get_item_details_with_source(
    client: &reqwest::Client,
    url: &str,
    item: &Item,
) -> core::result::Result<(ItemDetails, String, MediaSource, MediaLot), ImportFailedItem> {
    let Some(media_type) = item.media_type.as_ref() else {
        return Err(ImportFailedItem {
            identifier: item.id.to_string(),
            error: Some("No media type".to_string()),
            step: ImportFailStep::ItemDetailsFromSource,
            ..Default::default()
        });
    };
    let lot = MediaLot::from(media_type.clone());
    let rsp = client
        .get(format!("{}/details/{}", url, item.id))
        .send()
        .await
        .map_err(|e| ImportFailedItem {
            lot: Some(lot),
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: item.id.to_string(),
            error: Some(e.to_string()),
        })?;
    let details: ItemDetails = rsp.json().await.map_err(|e| {
        ryot_log!(
            debug,
            "Encountered error for id = {id:?}: {e:?}",
            id = item.id
        );
        ImportFailedItem {
            lot: Some(lot),
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: item.id.to_string(),
            error: Some(e.to_string()),
        }
    })?;
    let (identifier, source) = match media_type {
        MediaType::Book => {
            if let Some(_g_id) = details.goodreads_id {
                return Err(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::ItemDetailsFromSource,
                    identifier: details.id.to_string(),
                    error: Some("Goodreads ID not supported".to_string()),
                });
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
    Ok((details, identifier, source, lot))
}

async fn process_item(
    idx: usize,
    item: Item,
    total: usize,
    client: &reqwest::Client,
    url: &str,
) -> core::result::Result<ImportOrExportMetadataItem, ImportFailedItem> {
    let (details, identifier, source, lot) =
        get_item_details_with_source(client, url, &item).await?;

    ryot_log!(
        debug,
        "Got details for {lot:?}, with {seen} seen history: {id} ({idx}/{total})",
        lot = lot,
        id = item.id,
        idx = idx + 1,
        total = total,
        seen = details.seen_history.len()
    );

    let item = ImportOrExportMetadataItem {
        lot,
        source,
        identifier,
        source_id: item.id.to_string(),
        reviews: Vec::from_iter(details.user_rating.map(|r| {
            let review = if let Some(_s) = r.clone().review {
                Some(ImportOrExportItemReview {
                    date: r.date,
                    text: r.review,
                    spoiler: Some(false),
                    ..Default::default()
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
                ImportOrExportMetadataItemSeen {
                    ended_on: s.date.map(|d| d.date_naive()),
                    show_season_number: season_number,
                    show_episode_number: episode_number,
                    provider_watched_on: Some(ImportSource::Mediatracker.to_string()),
                    ..Default::default()
                }
            })
            .collect(),
        ..Default::default()
    };
    Ok(item)
}

pub async fn import(input: DeployUrlAndKeyImportInput) -> Result<ImportResult> {
    let api_url = input.api_url.trim_end_matches('/');
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(USER_AGENT_STR));
    headers.insert("Access-Token", input.api_key.parse().unwrap());
    let url = format!("{}/api", api_url);
    let client = ClientBuilder::new()
        .default_headers(headers)
        .build()
        .unwrap();

    let rsp = client.get(format!("{}/user", url)).send().await.unwrap();
    let data = rsp.json::<IdObject>().await.unwrap();

    let user_id: i32 = data.id;

    let mut failed = vec![];
    let mut completed = vec![];

    let rsp = client
        .get(format!("{}/lists", url))
        .query(&serde_json::json!({ "userId": user_id }))
        .send()
        .await
        .unwrap();
    let lists: Vec<ListResponse> = rsp.json().await.unwrap();

    completed.extend(lists.iter().map(|l| {
        ImportCompletedItem::Collection(CreateOrUpdateCollectionInput {
            name: l.name.clone(),
            description: l.description.as_ref().and_then(|s| match s.as_str() {
                "" => None,
                x => Some(x.to_owned()),
            }),
            ..Default::default()
        })
    }));

    for list in lists {
        let rsp = client
            .get(format!("{}/list/items", url))
            .query(&serde_json::json!({ "listId": list.id }))
            .send()
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.json().await.unwrap();
        for d in items {
            let (_details, identifier, source, lot) =
                match get_item_details_with_source(&client, &url, &d.media_item).await {
                    Ok(v) => v,
                    Err(error_item) => {
                        failed.push(error_item);
                        continue;
                    }
                };
            completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
                lot,
                source,
                identifier,
                collections: vec![list.name.clone()],
                ..Default::default()
            }));
        }
    }

    // all items returned here are seen at least once
    let rsp = client.get(format!("{}/items", url)).send().await.unwrap();
    let data: Vec<Item> = rsp.json().await.unwrap();

    let data_len = data.len();

    let results: Vec<_> = stream::iter(data.into_iter().enumerate())
        .map(|(idx, item)| process_item(idx, item, data_len, &client, &url))
        .buffer_unordered(5)
        .collect()
        .await;

    for result in results {
        match result {
            Ok(item) => completed.push(ImportCompletedItem::Metadata(item)),
            Err(error_item) => failed.push(error_item),
        }
    }

    Ok(ImportResult { completed, failed })
}
