use async_graphql::Result;
use chrono::NaiveDate;
use csv::Reader;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployMovaryImportInput, ImportFailStep, ImportFailedItem, ImportOrExportItemIdentifier,
        ImportOrExportMediaItem, ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    miscellaneous::DefaultCollection,
    models::media::{
        ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportMediaItemSeen,
    },
    utils::convert_naive_to_utc,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Common {
    title: String,
    tmdb_id: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rating {
    #[serde(flatten)]
    common: Common,
    user_rating: Decimal,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    #[serde(flatten)]
    common: Common,
    watched_at: NaiveDate,
    comment: Option<String>,
}

pub async fn import(input: DeployMovaryImportInput) -> Result<ImportResult> {
    let lot = MetadataLot::Movie;
    let source = MetadataSource::Tmdb;
    let mut media = vec![];
    let mut failed_items = vec![];
    let mut ratings_reader = Reader::from_reader(input.ratings.as_bytes());
    for (idx, result) in ratings_reader.deserialize().enumerate() {
        let record: Rating = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(format!("Ratings file: {:#?}", e)),
                });
                continue;
            }
        };
        media.push(ImportOrExportMediaItem {
            source_id: record.common.title,
            lot,
            source,
            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                record.common.tmdb_id.to_string(),
            )),
            identifier: "".to_string(),
            seen_history: vec![],
            reviews: vec![ImportOrExportItemRating {
                // DEV: Rates items out of 10
                rating: Some(record.user_rating.saturating_mul(dec!(10))),
                ..Default::default()
            }],
            collections: vec![],
        })
    }
    let mut watchlist_reader = Reader::from_reader(input.watchlist.as_bytes());
    for (idx, result) in watchlist_reader.deserialize().enumerate() {
        let record: Common = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(format!("Watchlist file: {:#?}", e)),
                });
                continue;
            }
        };
        media.push(ImportOrExportMediaItem {
            source_id: record.title,
            lot,
            source,
            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                record.tmdb_id.to_string(),
            )),
            identifier: "".to_string(),
            seen_history: vec![],
            reviews: vec![],
            collections: vec![DefaultCollection::Watchlist.to_string()],
        })
    }
    let mut history_reader = Reader::from_reader(input.history.as_bytes());
    for (idx, result) in history_reader.deserialize().enumerate() {
        let record: History = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(format!("History file: {:#?}", e)),
                });
                continue;
            }
        };
        let watched_at = Some(convert_naive_to_utc(record.watched_at));
        let seen_item = ImportOrExportMediaItemSeen {
            started_on: None,
            ended_on: watched_at,
            ..Default::default()
        };
        let review = record.comment.map(|c| ImportOrExportItemReview {
            spoiler: Some(false),
            text: Some(c),
            date: watched_at,
        });
        if let Some(media) = media
            .iter_mut()
            .find(|m| m.source_id == record.common.title)
        {
            if review.is_some() {
                if let Some(rating) = media.reviews.last_mut() {
                    rating.review = review;
                } else {
                    media.reviews.push(ImportOrExportItemRating {
                        review,
                        ..Default::default()
                    })
                }
            }
            media.seen_history.push(seen_item);
        } else {
            let mut reviews = vec![];
            if review.is_some() {
                reviews.push(ImportOrExportItemRating {
                    review,
                    ..Default::default()
                })
            }
            media.push(ImportOrExportMediaItem {
                source_id: record.common.title,
                lot,
                source,
                identifier: "".to_string(),
                internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                    record.common.tmdb_id.to_string(),
                )),
                seen_history: vec![seen_item],
                reviews,
                collections: vec![],
            })
        }
    }
    Ok(ImportResult {
        collections: vec![],
        media,
        failed_items,
        workouts: vec![],
    })
}
