use application_utils::get_base_http_client;
use async_graphql::Result;
use common_utils::{ryot_log, APPLICATION_JSON_HEADER};
use convert_case::{Case, Casing};
use dependent_models::ImportResult;
use enums::{ImportSource, MediaLot, MediaSource};
use env_utils::TRAKT_CLIENT_ID;
use itertools::Itertools;
use media_models::{
    CreateOrUpdateCollectionInput, DeployTraktImportInput, ImportOrExportItemRating,
    ImportOrExportItemReview, ImportOrExportMediaItemSeen,
};
use reqwest::header::{HeaderName, HeaderValue, CONTENT_TYPE};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use super::{ImportFailStep, ImportFailedItem, ImportOrExportMediaItem};

const API_URL: &str = "https://api.trakt.tv";
const API_VERSION: &str = "2";

#[derive(Debug, Serialize, Deserialize)]
struct Id {
    trakt: u64,
    tmdb: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Item {
    title: Option<String>,
    season: Option<i32>,
    number: Option<i32>,
    ids: Id,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListItemResponse {
    movie: Option<Item>,
    show: Option<Item>,
    episode: Option<Item>,
    watched_at: Option<DateTimeUtc>,
    rated_at: Option<DateTimeUtc>,
    rating: Option<Decimal>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ListResponse {
    name: String,
    description: Option<String>,
    ids: Id,
    #[serde(default)]
    items: Vec<ListItemResponse>,
}

pub async fn import(input: DeployTraktImportInput) -> Result<ImportResult> {
    let mut media = vec![];
    let mut failed_items = vec![];

    let url = format!("{}/users/{}", API_URL, input.username);
    let client = get_base_http_client(Some(vec![
        (CONTENT_TYPE, APPLICATION_JSON_HEADER.clone()),
        (
            HeaderName::from_static("trakt-api-key"),
            HeaderValue::from_static(TRAKT_CLIENT_ID),
        ),
        (
            HeaderName::from_static("trakt-api-version"),
            HeaderValue::from_static(API_VERSION),
        ),
    ]));
    let rsp = client.get(format!("{}/lists", url)).send().await.unwrap();
    let mut lists: Vec<ListResponse> = rsp.json().await.unwrap();

    for list in lists.iter_mut() {
        let rsp = client
            .get(format!("{}/lists/{}/items", url, list.ids.trakt))
            .send()
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.json().await.unwrap();
        list.items = items;
    }
    for list in ["watchlist", "favorites"] {
        let rsp = client
            .get(format!("{}/{}", url, list))
            .send()
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.json().await.unwrap();
        lists.push(ListResponse {
            name: list.to_owned(),
            description: None,
            ids: Id {
                trakt: 0,
                tmdb: None,
            },
            items,
        });
    }

    for l in lists.iter() {
        for i in l.items.iter() {
            match process_item(i) {
                Ok(mut d) => {
                    d.collections.push(l.name.to_case(Case::Title));
                    media.push(d)
                }
                Err(d) => failed_items.push(d),
            }
        }
    }

    let collections = lists
        .iter()
        .map(|l| CreateOrUpdateCollectionInput {
            name: l.name.to_case(Case::Title),
            description: l.description.as_ref().and_then(|s| {
                if s.is_empty() {
                    None
                } else {
                    Some(s.to_owned())
                }
            }),
            ..Default::default()
        })
        .collect_vec();

    for type_ in ["movies", "shows"] {
        let rsp = client
            .get(format!("{}/ratings/{}", url, type_))
            .send()
            .await
            .unwrap();
        let ratings: Vec<ListItemResponse> = rsp.json().await.unwrap();
        for item in ratings.iter() {
            match process_item(item) {
                Ok(mut d) => {
                    d.reviews.push(ImportOrExportItemRating {
                        rating: item
                            .rating
                            // DEV: Rates items out of 10
                            .map(|e| e * dec!(10)),
                        review: Some(ImportOrExportItemReview {
                            spoiler: Some(false),
                            text: None,
                            date: item.rated_at,
                            visibility: None,
                        }),
                        ..Default::default()
                    });
                    if let Some(a) = media.iter_mut().find(|i| i.source_id == d.source_id) {
                        a.reviews = d.reviews;
                    } else {
                        media.push(d)
                    }
                }
                Err(d) => failed_items.push(d),
            }
        }
    }

    let mut histories = vec![];
    let rsp = client
        .head(format!("{}/history", url))
        .query(&serde_json::json!({ "limit": 1000 }))
        .send()
        .await
        .unwrap();
    let total_history = rsp
        .headers()
        .get("x-pagination-page-count")
        .expect("pagination to be present")
        .to_str()
        .unwrap()
        .parse::<usize>()
        .unwrap();
    for page in 1..total_history + 1 {
        ryot_log!(debug, "Fetching user history {page:?}/{total_history:?}");
        let rsp = client
            .get(format!("{}/history", url))
            .query(&serde_json::json!({ "page": page, "limit": 1000 }))
            .send()
            .await
            .unwrap();
        let history: Vec<ListItemResponse> = rsp.json().await.unwrap();
        histories.extend(history);
    }

    for item in histories.iter() {
        match process_item(item) {
            Ok(mut d) => {
                let (show_season_number, show_episode_number) =
                    if let Some(e) = item.episode.as_ref() {
                        (e.season, e.number)
                    } else {
                        (None, None)
                    };
                if d.lot == MediaLot::Show
                    && (show_season_number.is_none() || show_episode_number.is_none())
                {
                    failed_items.push(ImportFailedItem {
                        lot: Some(d.lot),
                        step: ImportFailStep::ItemDetailsFromSource,
                        identifier: "".to_owned(),
                        error: Some(
                            "Item is a show but does not have a season or episode number"
                                .to_owned(),
                        ),
                    });
                    continue;
                }
                d.seen_history.push(ImportOrExportMediaItemSeen {
                    ended_on: item.watched_at.map(|d| d.date_naive()),
                    show_season_number,
                    provider_watched_on: Some(ImportSource::Trakt.to_string()),
                    show_episode_number,
                    ..Default::default()
                });
                if let Some(a) = media
                    .iter_mut()
                    .find(|i| i.identifier == d.identifier && i.lot == d.lot)
                {
                    a.seen_history.extend(d.seen_history);
                } else {
                    media.push(d)
                }
            }
            Err(d) => failed_items.push(d),
        }
    }
    Ok(ImportResult {
        collections,
        metadata: media,
        failed_items,
        ..Default::default()
    })
}

fn process_item(i: &ListItemResponse) -> Result<ImportOrExportMediaItem, ImportFailedItem> {
    let (source_id, identifier, lot) = if let Some(d) = i.movie.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Movie)
    } else if let Some(d) = i.show.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Show)
    } else {
        return Err(ImportFailedItem {
            lot: None,
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: "".to_owned(),
            error: Some("Item is neither a movie or a show".to_owned()),
        });
    };
    match identifier {
        Some(identifier) => Ok(ImportOrExportMediaItem {
            lot,
            source: MediaSource::Tmdb,
            source_id: source_id.to_string(),
            identifier: identifier.to_string(),
            ..Default::default()
        }),
        None => Err(ImportFailedItem {
            lot: None,
            identifier: "".to_owned(),
            step: ImportFailStep::ItemDetailsFromSource,
            error: Some("Item does not have an associated TMDB id".to_owned()),
        }),
    }
}
