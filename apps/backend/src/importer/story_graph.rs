use async_graphql::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use convert_case::{Case, Casing};
use csv::Reader;
use rust_decimal::{prelude::FromPrimitive, Decimal};
use serde::{Deserialize, Serialize};

use crate::{
    importer::{
        DeployStoryGraphImportInput, ImportFailStep, ImportFailedItem, ImportItem,
        ImportItemIdentifier, ImportItemRating, ImportItemReview, ImportItemSeen, ImportResult,
    },
    migrator::{MetadataLot, MetadataSource},
};

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum ReadStatus {
    #[serde(rename = "to-read")]
    ToRead,
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

pub async fn import(input: DeployStoryGraphImportInput) -> Result<ImportResult> {
    let lot = MetadataLot::Movie;
    let source = MetadataSource::Openlibrary;
    let mut media = vec![];
    let mut failed_items = vec![];
    let mut ratings_reader = Reader::from_reader(input.export.as_bytes());
    for (idx, result) in ratings_reader.deserialize().enumerate() {
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
        if let Some(isbn) = record.isbn {
            let mut seen_history = vec![
                ImportItemSeen {
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
                ReadStatus::Other(s) => s.to_case(Case::Title),
            });
            if let Some(t) = record.tags {
                collections.extend(t.split(", ").map(|d| d.to_case(Case::Title)))
            }
            media.push(ImportItem {
                source_id: record.title,
                lot,
                source,
                identifier: ImportItemIdentifier::NeedsDetails(isbn),
                seen_history,
                reviews: vec![ImportItemRating {
                    id: None,
                    rating: record.rating.map(|d| d / Decimal::from_u16(2).unwrap()),
                    review: record.review.map(|r| ImportItemReview {
                        date: None,
                        spoiler: false,
                        text: Some(r),
                    }),
                }],
                collections,
            })
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
