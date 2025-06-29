use std::result::Result as StdResult;

use async_graphql::Result;
use chrono::{NaiveDate, NaiveDateTime};
use common_models::DefaultCollection;
use common_utils::{convert_naive_to_utc, ryot_log};
use csv::Reader;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
struct HardcoverBook {
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Hardcover Book ID")]
    hardcover_book_id: String,
    #[serde(rename = "Lists")]
    lists: String,
    #[serde(rename = "Date Started")]
    date_started: Option<String>,
    #[serde(rename = "Date Finished")]
    date_finished: Option<String>,
    #[serde(rename = "Rating")]
    rating: Option<Decimal>,
    #[serde(rename = "Review")]
    review: Option<String>,
    #[serde(rename = "Review Contains Spoilers")]
    review_contains_spoilers: Option<String>,
    #[serde(rename = "Review Date")]
    review_date: Option<String>,
    #[serde(rename = "Owned")]
    owned: String,
}

pub async fn import(input: DeployGenericCsvImportInput) -> Result<ImportResult> {
    let lot = MediaLot::Book;
    let ratings_reader = Reader::from_path(input.csv_path)?
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();

    let results: Vec<_> = ratings_reader
        .into_iter()
        .enumerate()
        .map(|(idx, result)| process_hardcover_record(idx, result, total, lot))
        .collect();

    let mut completed = vec![];
    let mut failed = vec![];
    for result in results {
        match result {
            Ok(item) => completed.push(item),
            Err(error_item) => failed.push(error_item),
        }
    }

    Ok(ImportResult { completed, failed })
}

fn process_hardcover_record(
    idx: usize,
    result: csv::Result<HardcoverBook>,
    total: usize,
    lot: MediaLot,
) -> StdResult<ImportCompletedItem, ImportFailedItem> {
    let record: HardcoverBook = match result {
        Ok(r) => r,
        Err(e) => {
            return Err(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: idx.to_string(),
                error: Some(e.to_string()),
            });
        }
    };

    ryot_log!(debug, "Processing {}/{}: {}", idx + 1, total, record.title);

    // Use Hardcover Book ID as the identifier
    let source = enum_models::MediaSource::Hardcover;
    let identifier = record.hardcover_book_id.clone();

    // Validate that we have a valid Hardcover Book ID
    if identifier.is_empty() {
        return Err(ImportFailedItem {
            lot: Some(lot),
            step: ImportFailStep::ItemDetailsFromSource,
            identifier: record.title.clone(),
            error: Some("Empty Hardcover Book ID".to_string()),
        });
    }

    // Handle collections
    let mut collections = vec![];

    // Status-based collections
    match record.status.as_str() {
        "Currently Reading" => collections.push(DefaultCollection::InProgress.to_string()),
        "Want to Read" => collections.push(DefaultCollection::Watchlist.to_string()),
        _ => {} // "Read" status gets handled via seen_history
    }

    // Parse custom lists from Lists column
    if !record.lists.is_empty() {
        for list_entry in record.lists.split(',') {
            let list_name = list_entry.trim();
            // Remove the (#number) suffix: "Books That Changed My Life (#4)" -> "Books That Changed My Life"
            if let Some(clean_name) = list_name.split(" (#").next() {
                if !clean_name.is_empty() {
                    collections.push(clean_name.to_owned());
                }
            }
        }
    }

    // Handle Owned collection
    if record.owned.to_lowercase() == "true" {
        collections.push(DefaultCollection::Owned.to_string());
    }

    // Handle seen history for "Read" status or when Date Finished is present
    let mut seen_history = vec![];
    if record.status == "Read" || record.date_finished.is_some() {
        let mut seen_item = ImportOrExportMetadataItemSeen {
            provider_watched_on: Some(ImportSource::Hardcover.to_string()),
            ..Default::default()
        };

        // Set start date if available
        if let Some(date_started) = &record.date_started {
            if !date_started.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(date_started, "%Y-%m-%d") {
                    seen_item.started_on = Some(convert_naive_to_utc(date));
                }
            }
        }

        // Set end date if available
        if let Some(date_finished) = &record.date_finished {
            if !date_finished.is_empty() {
                if let Ok(date) = NaiveDate::parse_from_str(date_finished, "%Y-%m-%d") {
                    seen_item.ended_on = Some(convert_naive_to_utc(date));
                }
            }
        }

        seen_history.push(seen_item);
    }

    // Handle rating and review
    let mut reviews = vec![];
    if record.rating.is_some() || record.review.is_some() {
        let mut rating_review = ImportOrExportItemRating {
            rating: record.rating.map(|r| r.saturating_mul(dec!(2))), // Convert 5-star to 10-point scale
            ..Default::default()
        };

        if let Some(review_text) = &record.review {
            if !review_text.is_empty() {
                let spoiler = record
                    .review_contains_spoilers
                    .as_ref()
                    .map(|s| s.to_lowercase() == "true")
                    .unwrap_or(false);

                let mut review = ImportOrExportItemReview {
                    text: Some(review_text.clone()),
                    spoiler: Some(spoiler),
                    ..Default::default()
                };

                // Set review date if available
                if let Some(review_date) = &record.review_date {
                    if !review_date.is_empty() {
                        if let Ok(datetime) =
                            NaiveDateTime::parse_from_str(review_date, "%Y-%m-%dT%H:%M:%SZ")
                        {
                            review.date = Some(datetime.and_utc());
                        }
                    }
                }

                rating_review.review = Some(review);
            }
        }

        reviews.push(rating_review);
    }

    Ok(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
        lot,
        source,
        identifier,
        collections,
        seen_history,
        reviews,
        source_id: record.title.clone(),
    }))
}
