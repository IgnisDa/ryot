use async_graphql::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use convert_case::{Case, Casing};
use csv::Reader;
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployStoryGraphImportInput, ImportFailStep, ImportFailedItem, ImportOrExportItem,
        ImportOrExportItemIdentifier, ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
    models::media::{ImportOrExportItemRating, ImportOrExportItemReview, ImportOrExportItemSeen},
    providers::openlibrary::OpenlibraryService,
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
    openlibrary_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let lot = MetadataLot::Book;
    let source = MetadataSource::Openlibrary;
    let mut media = vec![];
    let mut failed_items = vec![];
    let ratings_reader = Reader::from_reader(input.export.as_bytes())
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
            if let Some(identifier) = openlibrary_service.id_from_isbn(&isbn).await {
                let mut seen_history = vec![
                    ImportOrExportItemSeen {
                        ..Default::default()
                    };
                    record.read_count
                ];
                if let Some(w) = record.last_date_read {
                    let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
                    let read_at = Some(DateTime::from_utc(
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
                media.push(ImportOrExportItem {
                    source_id: record.title,
                    lot,
                    source,
                    identifier: ImportOrExportItemIdentifier::NeedsDetails(identifier),
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
                        }),
                        show_season_number: None,
                        show_episode_number: None,
                        podcast_episode_number: None,
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
    })
}
