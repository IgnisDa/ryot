use async_graphql::Result;
use chrono::{DateTime, Utc};
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployGoodreadsImportInput, ImportOrExportItemIdentifier, ImportOrExportMediaItem,
        ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    miscellaneous::DefaultCollection,
    models::media::{
        BookSpecifics, FreeMetadataCreator, ImportOrExportItemRating, ImportOrExportItemReview,
        ImportOrExportMediaItemSeen, MediaDetails, MediaSpecifics, MetadataImageForMediaDetails,
        MetadataImageLot,
    },
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
                let mut single_review = ImportOrExportItemRating {
                    ..Default::default()
                };
                if !d.user_review.is_empty() {
                    single_review.review = Some(ImportOrExportItemReview {
                        date: None,
                        spoiler: Some(false),
                        text: Some(d.user_review),
                    });
                };
                if !d.user_rating.is_empty() {
                    let rating: Decimal = d.user_rating.parse().unwrap();
                    if rating != dec!(0) {
                        // DEV: Rates items out of 5
                        single_review.rating = Some(rating.saturating_mul(dec!(20)))
                    }
                };
                if single_review.review.is_some() || single_review.rating.is_some() {
                    reviews.push(single_review);
                }

                let mut seen_history = vec![];
                if !d.user_read_at.is_empty() {
                    seen_history.push(ImportOrExportMediaItemSeen {
                        ended_on: DateTime::parse_from_rfc2822(&d.user_read_at)
                            .ok()
                            .map(|d| d.with_timezone(&Utc)),
                        ..Default::default()
                    });
                }

                let mut default_collections = vec![];
                if d.user_shelves == "to-read" {
                    default_collections.push(DefaultCollection::Watchlist.to_string());
                }

                ImportOrExportMediaItem {
                    source_id: d.book_id.to_string(),
                    source: MetadataSource::Custom,
                    lot: MetadataLot::Book,
                    identifier: ImportOrExportItemIdentifier::AlreadyFilled(Box::new(
                        MediaDetails {
                            identifier: d.book_id.to_string(),
                            title: d.title,
                            description: Some(d.book_description),
                            production_status: "Released".to_owned(),
                            lot: MetadataLot::Book,
                            source: MetadataSource::Custom,
                            creators: vec![FreeMetadataCreator {
                                name: d.author_name,
                                role: "Author".to_owned(),
                                image: None,
                            }],
                            url_images: vec![MetadataImageForMediaDetails {
                                image: d.book_large_image_url,
                                lot: MetadataImageLot::Poster,
                            }],
                            specifics: MediaSpecifics::Book(BookSpecifics {
                                pages: d.book.num_pages.parse().ok(),
                            }),
                            publish_year: d.book_published.parse().ok(),
                            videos: vec![],
                            provider_rating: None,
                            publish_date: None,
                            genres: vec![],
                            suggestions: vec![],
                            groups: vec![],
                            is_nsfw: None,
                            people: vec![],
                            s3_images: vec![],
                        },
                    )),
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
