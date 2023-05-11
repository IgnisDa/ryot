use async_graphql::Result;
use serde::{Deserialize, Serialize};

use crate::{config::ImporterConfig, traits::MediaSpecifics};

use super::{DeployGoodreadsImportInput, ImportResult};

#[derive(Debug, Serialize, Deserialize)]
struct RssBookDetails {
    #[serde(default)]
    num_pages: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssItem {
    title: String,
    book_description: String,
    author_name: String,
    book_image_url: String,
    book_id: i32,
    book: RssBookDetails,
    book_published: String,
    user_shelves: String,
    user_read_at: String,
    user_review: String,
    user_rating: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssChannel {
    title: String,
    item: Vec<RssItem>,
}

#[derive(Debug, Serialize, Deserialize)]
struct RssDetail {
    channel: RssChannel,
}

pub async fn import<T>(
    input: DeployGoodreadsImportInput,
    config: &ImporterConfig,
) -> Result<ImportResult<T>>
where
    T: MediaSpecifics,
{
    let content = surf::get(format!("{}/{}", config.goodreads_rss_url, input.user_id))
        .await
        .unwrap()
        .body_string()
        .await
        .unwrap();
    let doc: RssDetail = quick_xml::de::from_str(&content).unwrap();
    let doc = doc
        .channel
        .item
        .into_iter()
        // .map(|d| (d.title, d.user_shelves))
        .rev()
        .collect::<Vec<_>>();
    dbg!(&doc);
    todo!("Since goodreads does not provide an API, it is difficult to get data reliably from there. We will use RSS instead.");
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
