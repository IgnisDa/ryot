use async_graphql::Result;
use chrono::{DateTime, Utc};
use itertools::Itertools;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployGoodreadsImportInput, ImportItem, ImportItemIdentifier, ImportItemRating,
        ImportItemReview, ImportItemSeen, ImportResult,
    },
    migrator::{MetadataImageLot, MetadataLot, MetadataSource},
    miscellaneous::{
        DefaultCollection, MediaSpecifics, MetadataCreator, MetadataImage, MetadataImageUrl,
    },
    models::media::{BookSpecifics, MediaDetails},
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
    book_large_image_url: String,
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

pub async fn import(input: DeployGoodreadsImportInput) -> Result<ImportResult> {
    let content = surf::get(input.rss_url)
        .await
        .unwrap()
        .body_string()
        .await
        .unwrap();
    let books: RssDetail = quick_xml::de::from_str(&content).unwrap();
    let books = books.channel.item.into_iter().collect_vec();
    Ok(ImportResult {
        media: books
            .into_iter()
            .map(|d| {
                let mut reviews = vec![];
                let mut single_review = ImportItemRating {
                    id: None,
                    review: None,
                    rating: None,
                };
                if !d.user_review.is_empty() {
                    single_review.review = Some(ImportItemReview {
                        date: None,
                        spoiler: false,
                        text: Some(d.user_review),
                    });
                };
                if !d.user_rating.is_empty() {
                    let rating = d.user_rating.parse().unwrap();
                    if rating != dec!(0) {
                        single_review.rating = Some(rating)
                    }
                };
                if single_review.review.is_some() || single_review.rating.is_some() {
                    reviews.push(single_review);
                }

                let mut seen_history = vec![];
                if !d.user_read_at.is_empty() {
                    seen_history.push(ImportItemSeen {
                        ended_on: DateTime::parse_from_rfc2822(&d.user_read_at)
                            .ok()
                            .map(|d| d.with_timezone(&Utc)),
                        show_season_number: None,
                        show_episode_number: None,
                        podcast_episode_number: None,
                    });
                }

                let mut default_collections = vec![];
                if d.user_shelves == "to-read" {
                    default_collections.push(DefaultCollection::Watchlist.to_string());
                }

                ImportItem {
                    source_id: d.book_id.to_string(),
                    source: MetadataSource::Custom,
                    lot: MetadataLot::Book,
                    identifier: ImportItemIdentifier::AlreadyFilled(Box::new(MediaDetails {
                        identifier: d.book_id.to_string(),
                        title: d.title,
                        description: Some(d.book_description),
                        lot: MetadataLot::Book,
                        source: MetadataSource::Custom,
                        creators: vec![MetadataCreator {
                            name: d.author_name,
                            role: "Author".to_owned(),
                            image_urls: vec![],
                        }],
                        genres: vec![],
                        images: vec![MetadataImage {
                            url: MetadataImageUrl::Url(d.book_large_image_url),
                            lot: MetadataImageLot::Poster,
                        }],
                        publish_year: d.book_published.parse().ok(),
                        publish_date: None,
                        specifics: MediaSpecifics::Book(BookSpecifics {
                            pages: d.book.num_pages.parse().ok(),
                        }),
                    })),
                    seen_history,
                    collections: default_collections,
                    reviews,
                }
            })
            .collect(),
        failed_items: vec![],
        collections: vec![],
    })
}
