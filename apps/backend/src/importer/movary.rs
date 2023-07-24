use async_graphql::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use csv::Reader;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployMovaryImportInput, ImportFailStep, ImportFailedItem, ImportItem,
        ImportItemIdentifier, ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    models::media::{ImportItemRating, ImportItemReview, ImportItemSeen},
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
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        media.push(ImportItem {
            source_id: record.common.title,
            lot,
            source,
            identifier: ImportItemIdentifier::NeedsDetails(record.common.tmdb_id.to_string()),
            seen_history: vec![],
            reviews: vec![ImportItemRating {
                // DEV: Rates items out of 10
                rating: Some(record.user_rating.saturating_mul(dec!(10))),
                review: None,
            }],
            collections: vec![],
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
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let watched_at = Some(DateTime::from_utc(
            NaiveDateTime::new(record.watched_at, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
            Utc,
        ));
        let seen_item = ImportItemSeen {
            started_on: None,
            ended_on: watched_at,
            show_season_number: None,
            show_episode_number: None,
            podcast_episode_number: None,
        };
        let review = record.comment.map(|c| ImportItemReview {
            spoiler: false,
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
                    media.reviews.push(ImportItemRating {
                        review,
                        rating: None,
                    })
                }
            }
            media.seen_history.push(seen_item);
        } else {
            let mut reviews = vec![];
            if review.is_some() {
                reviews.push(ImportItemRating {
                    review,
                    rating: None,
                })
            }
            media.push(ImportItem {
                source_id: record.common.title,
                lot,
                source,
                identifier: ImportItemIdentifier::NeedsDetails(record.common.tmdb_id.to_string()),
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
    })
}
