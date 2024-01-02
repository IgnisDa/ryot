use std::fs;

use async_graphql::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use convert_case::{Case, Casing};
use csv::Reader;
use database::{MetadataLot, MetadataSource};
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployStoryGraphImportInput, ImportFailStep, ImportFailedItem,
        ImportOrExportItemIdentifier, ImportOrExportMediaItem, ImportResult,
    },
    models::media::{
        ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportMediaItemSeen,
    },
    providers::google_books::GoogleBooksService,
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ReadStatus {
    #[serde(rename = "to-read")]
    ToRead,
    #[serde(rename = "currently-reading")]
    CurrentlyReading,
    Other(String),
}

#[derive(Debug, Serialize, Deserialize)]
struct History {
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "ISBN/UID")]
    isbn: Option<String>,
    #[serde(rename = "Read Status")]
    read_status: ReadStatus,
    #[serde(rename = "Read Count")]
    read_count: usize,
    #[serde(rename = "Star Rating")]
    rating: Option<Decimal>,
    #[serde(rename = "Review")]
    review: Option<String>,
    #[serde(rename = "Last Date Read")]
    last_date_read: Option<String>,
    #[serde(rename = "Tags")]
    tags: Option<String>,
}

pub async fn import(
    input: DeployStoryGraphImportInput,
    isbn_service: &GoogleBooksService,
) -> Result<ImportResult> {
    let lot = MetadataLot::Book;
    let source = MetadataSource::GoogleBooks;
    let mut media = vec![];
    let mut failed_items = vec![];
    let export = fs::read_to_string(&input.export)?;
    let ratings_reader = Reader::from_reader(export.as_bytes())
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
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
        tracing::debug!(
            "Getting details for {title:?} ({idx}/{total})",
            title = record.title
        );
        if let Some(isbn) = record.isbn {
            if let Some(identifier) = isbn_service.id_from_isbn(&isbn).await {
                let mut seen_history = vec![
                    ImportOrExportMediaItemSeen {
                        started_on: None,
                        ended_on: None,
                        ..Default::default()
                    };
                    record.read_count
                ];
                if let Some(w) = record.last_date_read {
                    let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
                    let read_at = Some(DateTime::from_naive_utc_and_offset(
                        NaiveDateTime::new(w, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                        Utc,
                    ));
                    seen_history.first_mut().unwrap().ended_on = read_at;
                }
                let mut collections = vec![];
                collections.push(match record.read_status {
                    ReadStatus::ToRead => "Watchlist".to_owned(),
                    ReadStatus::CurrentlyReading => "In Progress".to_owned(),
                    ReadStatus::Other(s) => s.to_case(Case::Title),
                });
                if let Some(t) = record.tags {
                    collections.extend(t.split(", ").map(|d| d.to_case(Case::Title)))
                }
                media.push(ImportOrExportMediaItem {
                    source_id: record.title,
                    lot,
                    source,
                    identifier: "".to_string(),
                    internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(
                        identifier,
                    )),
                    seen_history,
                    reviews: vec![ImportOrExportItemRating {
                        rating: record
                            .rating
                            // DEV: Rates items out of 10
                            .map(|d| d.saturating_mul(dec!(10))),
                        review: record.review.map(|r| ImportOrExportItemReview {
                            date: None,
                            spoiler: Some(false),
                            text: Some(r),
                            visibility: None,
                        }),
                        ..Default::default()
                    }],
                    collections,
                })
            } else {
                failed_items.push(ImportFailedItem {
                    lot,
                    step: ImportFailStep::InputTransformation,
                    identifier: record.title,
                    error: Some(format!(
                        "Could not convert ISBN: {} to Openlibrary ID",
                        isbn
                    )),
                })
            }
        } else {
            failed_items.push(ImportFailedItem {
                lot,
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some("No ISBN found".to_owned()),
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
