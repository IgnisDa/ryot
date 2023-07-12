use async_graphql::Result;
use convert_case::{Case, Casing};
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use surf::{http::headers::CONTENT_TYPE, Client, Url};

use crate::{
    importer::{
        DeployTraktImportInput, ImportFailStep, ImportFailedItem, ImportItem, ImportItemIdentifier,
        ImportItemRating, ImportItemReview, ImportItemSeen, ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    models::media::CreateOrUpdateCollectionInput,
    utils::get_base_http_client_config,
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
    rating: Option<u8>,
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
    let mut media_items = vec![];
    let mut failed_items = vec![];

    let client: Client = get_base_http_client_config()
        .add_header(CONTENT_TYPE, "application/json")
        .unwrap()
        .add_header("trakt-api-key", CLIENT_ID)
        .unwrap()
        .add_header("trakt-api-version", API_VERSION)
        .unwrap()
        .set_base_url(Url::parse(&format!("{}/users/{}/", API_URL, input.username)).unwrap())
        .try_into()
        .unwrap();
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
        let mut rsp = client.get(&format!("{}", list)).await.unwrap();
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
                    media_items.push(d)
                }
                Err(d) => failed_items.push(d),
            }
        }
    }

    let all_collections = lists
        .iter()
        .map(|l| CreateOrUpdateCollectionInput {
            name: l.name.to_case(Case::Title),
            description: l
                .description
                .as_ref()
                .map(|s| if s == "" { None } else { Some(s.to_owned()) })
                .flatten(),
            ..Default::default()
        })
        .collect::<Vec<_>>();
    let mut rsp = client.get("ratings").await.unwrap();
    let ratings: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
    for item in ratings.iter() {
        match process_item(item) {
            Ok(mut d) => {
                d.reviews.push(ImportItemRating {
                    id: None,
                    rating: item
                        .rating
                        // DEV: Trakt rates items out of 10
                        .map(|e| Decimal::from_f32_retain((e / 2).into()))
                        .flatten(),
                    review: Some(ImportItemReview {
                        spoiler: false,
                        text: Some("".to_owned()),
                        date: item.rated_at,
                    }),
                });
                media_items.push(d)
            }
            Err(d) => failed_items.push(d),
        }
    }

    let mut histories = vec![];
    let rsp = client.get("history").await.unwrap();
    let total_history = rsp
        .header("x-pagination-page-count")
        .expect("pagination to be present")
        .last()
        .as_str()
        .parse::<usize>()
        .unwrap();
    for page in 1..total_history + 1 {
        let mut rsp = client
            .get("history")
            .query(&serde_json::json!({ "page": page }))
            .unwrap()
            .await
            .unwrap();
        let history: Vec<ListItemResponse> = rsp.body_json().await.unwrap();
        histories.extend(history);
    }

    for item in histories.iter() {
        let (show_season_number, show_episode_number) = if let Some(e) = item.episode.as_ref() {
            (e.season, e.number)
        } else {
            (None, None)
        };
        match process_item(item) {
            Ok(mut d) => {
                d.seen_history.push(ImportItemSeen {
                    id: None,
                    podcast_episode_number: None,
                    ended_on: item.watched_at,
                    show_season_number,
                    show_episode_number,
                });
                media_items.push(d)
            }
            Err(d) => failed_items.push(d),
        }
    }
    Ok(ImportResult {
        collections: all_collections,
        media: media_items,
        failed_items,
    })
}

fn process_item(i: &ListItemResponse) -> std::result::Result<ImportItem, ImportFailedItem> {
    let (source_id, identifier, lot) = if let Some(d) = i.movie.as_ref() {
        (d.ids.trakt.clone(), d.ids.tmdb.clone(), MetadataLot::Movie)
    } else if let Some(d) = i.show.as_ref() {
        (d.ids.trakt.clone(), d.ids.tmdb.clone(), MetadataLot::Show)
    } else {
        return Err(ImportFailedItem {
            lot: MetadataLot::Book,
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: "".to_owned(),
            error: Some("Item is neither a movie or a show".to_owned()),
        });
    };
    Ok(ImportItem {
        source_id: source_id.to_string(),
        lot,
        identifier: ImportItemIdentifier::NeedsDetails(identifier.unwrap().to_string()),
        source: MetadataSource::Tmdb,
        seen_history: vec![],
        reviews: vec![],
        collections: vec![],
    })
}
