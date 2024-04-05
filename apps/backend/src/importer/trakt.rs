use async_graphql::Result;
use convert_case::{Case, Casing};
use database::{ImportSource, MediaLot, MediaSource};
use http_types::mime;
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::http::headers::CONTENT_TYPE;

use crate::{
    importer::{
        DeployTraktImportInput, ImportFailStep, ImportFailedItem, ImportOrExportItemIdentifier,
        ImportOrExportMediaItem, ImportResult,
    },
    models::media::{
        CreateOrUpdateCollectionInput, ImportOrExportItemRating, ImportOrExportItemReview,
        ImportOrExportMediaItemSeen,
    },
    utils::get_base_http_client,
};

const API_URL: &str = "https://api.trakt.tv";
const CLIENT_ID: &str = "b3d93fd4c53d78d61b18e0f0bf7ad5153de323788dbc0be1a3627205a36e89f5";
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

    let client = get_base_http_client(
        &format!("{}/users/{}/", API_URL, input.username),
        vec![
            (CONTENT_TYPE, mime::JSON.to_string().as_str()),
            ("trakt-api-key".into(), CLIENT_ID),
            ("trakt-api-version".into(), API_VERSION),
        ],
    );
    let mut rsp = client.get("lists").await.unwrap();
    let mut lists: Vec<ListResponse> = rsp.body_json().await.unwrap();

    for list in lists.iter_mut() {
        let mut rsp = client
            .get(&format!("lists/{}/items", list.ids.trakt))
            .await
            .unwrap();
        let items: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
        list.items = items;
    }
    for list in ["watchlist", "favorites"] {
        let mut rsp = client.get(list).await.unwrap();
        let items: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
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

    for typ in ["movies", "shows"] {
        let mut rsp = client.get(format!("ratings/{}", typ)).await.unwrap();
        let ratings: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
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
        .head("history")
        .query(&serde_json::json!({ "limit": 1000 }))
        .unwrap()
        .await
        .unwrap();
    let total_history = rsp
        .header("x-pagination-page-count")
        .expect("pagination to be present")
        .last()
        .as_str()
        .parse::<usize>()
        .unwrap();
    for page in 1..total_history + 1 {
        tracing::debug!("Fetching user history {page:?}/{total_history:?}");
        let mut rsp = client
            .get("history")
            .query(&serde_json::json!({ "page": page, "limit": 1000 }))
            .unwrap()
            .await
            .unwrap();
        let history: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
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
                    ended_on: item.watched_at,
                    show_season_number,
                    provider_watched_on: Some(ImportSource::Trakt.to_string()),
                    show_episode_number,
                    ..Default::default()
                });
                if let Some(a) = media.iter_mut().find(|i| i.source_id == d.source_id) {
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
        media,
        failed_items,
        ..Default::default()
    })
}

fn process_item(
    i: &ListItemResponse,
) -> std::result::Result<ImportOrExportMediaItem, ImportFailedItem> {
    let (source_id, identifier, lot, title) = if let Some(d) = i.movie.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Movie, d.title.clone())
    } else if let Some(d) = i.show.as_ref() {
        (d.ids.trakt, d.ids.tmdb, MediaLot::Show, d.title.clone())
    } else {
        return Err(ImportFailedItem {
            lot: None,
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: "".to_owned(),
            error: Some("Item is neither a movie or a show".to_owned()),
        });
    };
    let title = title.unwrap_or_default();
    match identifier {
        Some(i) => Ok(ImportOrExportMediaItem {
            source_id: source_id.to_string(),
            lot,
            identifier: title.clone(),
            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails {
                identifier: i.to_string(),
                title,
            }),
            source: MediaSource::Tmdb,
            seen_history: vec![],
            reviews: vec![],
            collections: vec![],
        }),
        None => Err(ImportFailedItem {
            lot: None,
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: "".to_owned(),
            error: Some("Item does not have an associated TMDB id".to_owned()),
        }),
    }
}
