use async_graphql::Result;
use serde::{Deserialize, Serialize};

use crate::{
    books::BookSpecifics,
    config::ImporterConfig,
    media::{resolver::MediaDetails, MediaSpecifics},
    migrator::{BookSource, MetadataLot},
};

use super::{
    DeployGoodreadsImportInput, ImportItem, ImportItemIdentifier, ImportItemRating,
    ImportItemReview, ImportResult,
};

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

pub async fn import(
    input: DeployGoodreadsImportInput,
    config: &ImporterConfig,
) -> Result<ImportResult> {
    let content = surf::get(format!("{}/{}", config.goodreads_rss_url, input.user_id))
        .await
        .unwrap()
        .body_string()
        .await
        .unwrap();
    let doc: RssDetail = quick_xml::de::from_str(&content).unwrap();
    let doc = doc.channel.item.into_iter().collect::<Vec<_>>();
    Ok(ImportResult {
        media: doc
            .into_iter()
            .map(|d| ImportItem {
                source_id: d.book_id.to_string(),
                lot: MetadataLot::Book,
                identifier: ImportItemIdentifier::AlreadyFilled(MediaDetails {
                    identifier: d.book_id.to_string(),
                    title: d.title,
                    description: Some(d.book_description),
                    lot: MetadataLot::Book,
                    creators: vec![d.author_name],
                    genres: vec![],
                    poster_images: vec![d.book_image_url],
                    backdrop_images: vec![],
                    publish_year: d.book_published.parse().ok(),
                    publish_date: None,
                    specifics: MediaSpecifics::Book(BookSpecifics {
                        pages: d.book.num_pages.parse().ok(),
                        source: BookSource::Goodreads,
                    }),
                }),
                seen_history: vec![],
                reviews: vec![ImportItemRating {
                    id: None,
                    review: Some(ImportItemReview {
                        date: None,
                        spoiler: false,
                        text: d.user_review,
                    }),
                    rating: None,
                }],
            })
            .collect(),
        failed_items: vec![],
    })
}
