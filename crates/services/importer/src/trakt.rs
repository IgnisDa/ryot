use application_utils::get_base_http_client;
use async_graphql::Result;
use common_utils::{APPLICATION_JSON_HEADER, ryot_log};
use convert_case::{Case, Casing};
use dependent_models::{CollectionToEntityDetails, ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    CreateOrUpdateCollectionInput, DeployTraktImportInput, DeployTraktImportListInput,
    ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportMetadataItemSeen,
};
use reqwest::header::{CONTENT_TYPE, HeaderName, HeaderValue};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

use super::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

const API_URL: &str = "https://api.trakt.tv";
const API_VERSION: &str = "2";

async fn fetch_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
    query: Option<&serde_json::Value>,
) -> Result<T, reqwest::Error> {
    let mut request = client.get(url);
    if let Some(q) = query {
        request = request.query(q);
    }
    request.send().await?.json().await
}

#[derive(Debug, Default, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize, Default)]
struct ListResponse {
    ids: Id,
    name: String,
    description: Option<String>,
    #[serde(default)]
    items: Vec<ListItemResponse>,
}

pub async fn import(input: DeployTraktImportInput, client_id: &str) -> Result<ImportResult> {
    let mut failed = vec![];

    let client = get_base_http_client(Some(vec![
        (CONTENT_TYPE, APPLICATION_JSON_HEADER.clone()),
        (
            HeaderName::from_static("trakt-api-key"),
            HeaderValue::from_str(client_id).unwrap(),
        ),
        (
            HeaderName::from_static("trakt-api-version"),
            HeaderValue::from_static(API_VERSION),
        ),
    ]));
    let completed = match input {
        DeployTraktImportInput::List(DeployTraktImportListInput { url, collection }) => {
            let mut completed = vec![];

            // URL format: https://trakt.tv/users/{username}/lists/{list_slug}?some=other
            let url_parts: Vec<&str> = url.split('/').collect();
            if url_parts.len() < 6 || url_parts[3] != "users" || url_parts[5] != "lists" {
                failed.push(ImportFailedItem {
                    identifier: url.clone(),
                    step: ImportFailStep::ItemDetailsFromSource,
                    error: Some("Invalid Trakt list URL format".to_owned()),
                    ..Default::default()
                });
                return Ok(ImportResult {
                    failed,
                    ..Default::default()
                });
            }

            let username = url_parts[4];
            let list_slug = url_parts[6].split('?').next().unwrap_or(url_parts[6]);

            let api_url = format!("{}/users/{}/lists/{}/items", API_URL, username, list_slug);

            let items: Vec<ListItemResponse> = fetch_json(&client, &api_url, None).await?;

            for item in items.iter() {
                match process_item(item) {
                    Ok(mut d) => {
                        d.collections.push(CollectionToEntityDetails {
                            collection_name: collection.clone(),
                            ..Default::default()
                        });
                        completed.push(ImportCompletedItem::Metadata(d));
                    }
                    Err(e) => failed.push(e),
                }
            }

            completed
        }
        DeployTraktImportInput::User(username) => {
            let mut completed = vec![];
            let url = format!("{}/users/{}", API_URL, username);
            let mut lists: Vec<ListResponse> =
                fetch_json(&client, &format!("{}/lists", url), None).await?;

            for list in lists.iter_mut() {
                let items: Vec<ListItemResponse> = fetch_json(
                    &client,
                    &format!("{}/lists/{}/items", url, list.ids.trakt),
                    None,
                )
                .await?;
                list.items = items;
            }
            for list in ["watchlist", "favorites"] {
                let items: Vec<ListItemResponse> =
                    fetch_json(&client, &format!("{}/{}", url, list), None).await?;
                lists.push(ListResponse {
                    items,
                    name: list.to_owned(),
                    ..Default::default()
                });
            }

            for typ in ["movies", "shows"] {
                let items: Vec<ListItemResponse> =
                    fetch_json(&client, &format!("{}/collection/{}", url, typ), None).await?;
                for item in items.iter() {
                    match process_item(item) {
                        Ok(mut d) => {
                            d.collections.push(CollectionToEntityDetails {
                                collection_name: "Owned".to_string(),
                                ..Default::default()
                            });
                            completed.push(d);
                        }
                        Err(e) => failed.push(e),
                    }
                }
                let ratings: Vec<ListItemResponse> =
                    fetch_json(&client, &format!("{}/ratings/{}", url, typ), None).await?;
                for item in ratings.iter() {
                    match process_item(item) {
                        Ok(mut d) => {
                            d.reviews.push(ImportOrExportItemRating {
                                rating: item
                                    .rating
                                    // DEV: Rates items out of 10
                                    .map(|e| e * dec!(10)),
                                review: Some(ImportOrExportItemReview {
                                    date: item.rated_at,
                                    spoiler: Some(false),
                                    ..Default::default()
                                }),
                                ..Default::default()
                            });
                            completed.push(d)
                        }
                        Err(d) => failed.push(d),
                    }
                }
            }

            for l in lists.iter() {
                for i in l.items.iter() {
                    match process_item(i) {
                        Ok(mut d) => {
                            d.collections.push(CollectionToEntityDetails {
                                collection_name: l.name.to_case(Case::Title),
                                ..Default::default()
                            });
                            completed.push(d)
                        }
                        Err(d) => failed.push(d),
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
                let history: Vec<ListItemResponse> = fetch_json(
                    &client,
                    &format!("{}/history", url),
                    Some(&serde_json::json!({ "page": page, "limit": 1000 })),
                )
                .await?;
                histories.extend(history);
            }

            histories.sort_by_key(|h| h.watched_at.unwrap_or_default());

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
                            failed.push(ImportFailedItem {
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
                        d.seen_history.push(ImportOrExportMetadataItemSeen {
                            show_season_number,
                            show_episode_number,
                            ended_on: item.watched_at,
                            provider_watched_on: Some(ImportSource::Trakt.to_string()),
                            ..Default::default()
                        });
                        completed.push(d);
                    }
                    Err(d) => failed.push(d),
                }
            }

            let mut completed = completed
                .into_iter()
                .map(ImportCompletedItem::Metadata)
                .collect_vec();
            completed.extend(lists.iter().map(|l| {
                ImportCompletedItem::Collection(CreateOrUpdateCollectionInput {
                    name: l.name.to_case(Case::Title),
                    description: l.description.as_ref().and_then(|s| match s.is_empty() {
                        true => None,
                        false => Some(s.to_owned()),
                    }),
                    ..Default::default()
                })
            }));
            completed
        }
    };
    Ok(ImportResult { completed, failed })
}

fn process_item(i: &ListItemResponse) -> Result<ImportOrExportMetadataItem, ImportFailedItem> {
    let (source_id, identifier, lot) = if let Some(d) = i.movie.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Movie)
    } else if let Some(d) = i.show.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Show)
    } else {
        return Err(ImportFailedItem {
            identifier: format!("{:#?}", i),
            step: ImportFailStep::ItemDetailsFromSource,
            error: Some("Item is neither a movie or a show".to_owned()),
            ..Default::default()
        });
    };
    match identifier {
        Some(identifier) => Ok(ImportOrExportMetadataItem {
            lot,
            source: MediaSource::Tmdb,
            source_id: source_id.to_string(),
            identifier: identifier.to_string(),
            ..Default::default()
        }),
        None => Err(ImportFailedItem {
            identifier: format!("{:#?}", i),
            step: ImportFailStep::ItemDetailsFromSource,
            error: Some("Item does not have an associated TMDB id".to_owned()),
            ..Default::default()
        }),
    }
}
