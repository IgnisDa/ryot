use async_graphql::Result;
use feed_rs::parser;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};
use serde_with::{formats::Flexible, serde_as, TimestampMilliSeconds};
use surf::{http::headers::USER_AGENT, Client, Config, Url};

use crate::{
    config::ImporterConfig,
    graphql::{AUTHOR, PROJECT_NAME},
    importer::{
        media_tracker::utils::extract_review_information, ImportItemRating, ImportItemSeen,
    },
    migrator::MetadataLot,
    utils::openlibrary,
};

use super::{
    DeployGoodreadsImportInput, DeployMediaTrackerImportInput, ImportFailStep, ImportFailedItem,
    ImportItem, ImportResult,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
enum MediaType {
    Book,
    Movie,
    Tv,
    VideoGame,
    Audiobook,
}

impl From<MediaType> for MetadataLot {
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
#[serde(rename_all = "camelCase")]
struct Item {
    id: i32,
    media_type: MediaType,
    audible_id: Option<String>,
    igdb_id: Option<i32>,
    tmdb_id: Option<i32>,
    openlibrary_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemReview {
    id: i32,
    rating: Option<i32>,
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
    #[serde_as(as = "TimestampMilliSeconds<i64, Flexible>")]
    date: DateTimeUtc,
    episode_id: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ItemDetails {
    seen_history: Vec<ItemSeen>,
    seasons: Vec<ItemSeason>,
    user_rating: Option<ItemReview>,
}

pub async fn import(
    input: DeployGoodreadsImportInput,
    config: &ImporterConfig,
) -> Result<ImportResult> {
    let content = surf::get(format!("{}/{}", config.goodreads_rss_url, input.user_id))
        .await
        .unwrap()
        .body_bytes()
        .await
        .unwrap();
    let feed = parser::parse(&content[..]).unwrap();
    dbg!(&feed);
    todo!("Since goodreads does not provide an API, it is difficult to get data reliably from there. And I find RSS stupid. Instead I would like to use the `identifier` field of openlibrary responses to get the correct data.");
    // let client: Client = Config::new()
    //     .add_header(USER_AGENT, format!("{}/{}", AUTHOR, PROJECT_NAME))
    //     .unwrap()
    //     .add_header("Access-Token", input.api_key)
    //     .unwrap()
    //     .set_base_url(Url::parse(&format!("{}/api/", input.api_url)).unwrap())
    //     .try_into()
    //     .unwrap();

    // let mut failed_items = vec![];

    // // all items returned here are seen atleast once
    // let mut rsp = client.get("items").await.unwrap();
    // let data: Vec<Item> = rsp.body_json().await.unwrap();
    // let len = data.len();

    // let mut final_data = vec![];
    // for (idx, d) in data.into_iter().enumerate() {
    //     let lot = MetadataLot::from(d.media_type.clone());
    //     let identifier = match d.media_type.clone() {
    //         MediaType::Book => openlibrary::get_key(&d.openlibrary_id.clone().unwrap()),
    //         MediaType::Movie => d.tmdb_id.unwrap().to_string(),
    //         MediaType::Tv => d.tmdb_id.unwrap().to_string(),
    //         MediaType::VideoGame => d.igdb_id.unwrap().to_string(),
    //         MediaType::Audiobook => d.audible_id.clone().unwrap(),
    //     };
    //     let mut rsp = client.get(format!("details/{}", d.id)).await.unwrap();
    //     let details: ItemDetails = rsp
    //         .body_json()
    //         .await
    //         .map_err(|_| {
    //             failed_items.push(ImportFailedItem {
    //                 lot,
    //                 step: ImportFailStep::ItemDetailsFromSource,
    //                 identifier: d.id.to_string(),
    //             });
    //         })
    //         .unwrap();
    //     tracing::trace!(
    //         "Got details for {type:?}: {id} ({idx}/{total})",
    //         type = d.media_type,
    //         id = d.id,
    //         idx = idx,
    //         total = len
    //     );
    //     final_data.push(ImportItem {
    //         source_id: d.id.to_string(),
    //         lot,
    //         identifier,
    //         reviews: Vec::from_iter(details.user_rating.map(|r| {
    //             let review = if let Some(s) = r.review.map(|s| extract_review_information(&s)) {
    //                 s
    //             } else {
    //                 failed_items.push(ImportFailedItem {
    //                     lot,
    //                     step: ImportFailStep::ReviewTransformation,
    //                     identifier: d.id.to_string(),
    //                 });
    //                 None
    //             };
    //             ImportItemRating {
    //                 id: r.id.to_string(),
    //                 review,
    //                 rating: r.rating,
    //             }
    //         })),
    //         seen_history: details
    //             .seen_history
    //             .iter()
    //             .map(|s| {
    //                 let (season_number, episode_number) = if let Some(c) = s.episode_id {
    //                     let episode = details
    //                         .seasons
    //                         .iter()
    //                         .flat_map(|e| e.episodes.to_owned())
    //                         .find(|e| e.id == c)
    //                         .unwrap();
    //                     (Some(episode.season_number), Some(episode.episode_number))
    //                 } else {
    //                     (None, None)
    //                 };
    //                 ImportItemSeen {
    //                     id: s.id.to_string(),
    //                     ended_on: Some(s.date),
    //                     season_number,
    //                     episode_number,
    //                 }
    //             })
    //             .collect(),
    //     });
    // }
    // Ok(ImportResult {
    //     media: final_data,
    //     failed_items,
    // })
}
