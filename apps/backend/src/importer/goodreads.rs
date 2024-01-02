use std::fs;

use async_graphql::Result;
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use convert_case::{Case, Casing};
use csv::Reader;
use database::{MetadataLot, MetadataSource};
use itertools::Itertools;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;

use crate::{
    importer::{DeployGoodreadsImportInput, ImportFailStep, ImportFailedItem, ImportResult},
    models::media::{
        ImportOrExportItemIdentifier, ImportOrExportItemRating, ImportOrExportItemReview,
        ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
    },
    providers::google_books::GoogleBooksService,
};

#[derive(Debug, Deserialize)]
struct Book {
    #[serde(rename = "Book Id")]
    id: String,
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "ISBN13")]
    isbn13: String,
    #[serde(rename = "My Rating")]
    rating: Decimal,
    #[serde(rename = "Date Read")]
    date_read: Option<String>,
    #[serde(rename = "Bookshelves")]
    bookshelf: String,
    #[serde(rename = "My Review")]
    review: String,
    #[serde(rename = "Read Count")]
    read_count: usize,
}

pub async fn import(
    input: DeployGoodreadsImportInput,
    isbn_service: &GoogleBooksService,
) -> Result<ImportResult> {
    let lot = MetadataLot::Book;
    let source = MetadataSource::GoogleBooks;
    let mut media = vec![];
    let mut failed_items = vec![];
    let export = fs::read_to_string(&input.csv_path)?;
    let ratings_reader = Reader::from_reader(export.as_bytes())
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Book = match result {
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
        let isbn = record.isbn13[2..record.isbn13.len() - 1].to_owned();
        if isbn.is_empty() {
            failed_items.push(ImportFailedItem {
                lot,
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some("ISBN is empty".to_owned()),
            });
            continue;
        }
        if let Some(identifier) = isbn_service.id_from_isbn(&isbn).await {
            let mut seen_history = vec![
                ImportOrExportMediaItemSeen {
                    started_on: None,
                    ended_on: None,
                    ..Default::default()
                };
                record.read_count
            ];
            if let Some(w) = record.date_read {
                let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
                let read_at = Some(DateTime::from_naive_utc_and_offset(
                    NaiveDateTime::new(w, NaiveTime::from_hms_opt(0, 0, 0).unwrap()),
                    Utc,
                ));
                seen_history.first_mut().unwrap().ended_on = read_at;
            }
            let mut collections = vec![];
            if !record.bookshelf.is_empty() {
                collections.push(match record.bookshelf.as_str() {
                    "to-read" => "Watchlist".to_owned(),
                    "currently-reading" => "In Progress".to_owned(),
                    s => s.to_case(Case::Title),
                });
            }
            let mut rating = None;
            if record.rating > dec!(0) {
                rating = Some(
                    record
                        .rating
                        // DEV: Rates items out of 10
                        .saturating_mul(dec!(10)),
                );
            }
            let mut review = None;
            if !record.review.is_empty() {
                review = Some(ImportOrExportItemReview {
                    date: None,
                    spoiler: Some(false),
                    text: Some(record.review),
                    visibility: None,
                });
            }
            let mut reviews = vec![];
            if review.is_some() || rating.is_some() {
                reviews.push(ImportOrExportItemRating {
                    review,
                    rating,
                    ..Default::default()
                });
            }
            media.push(ImportOrExportMediaItem {
                source_id: record.title,
                lot,
                source,
                identifier: record.id,
                internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(identifier)),
                seen_history,
                reviews,
                collections,
            });
        } else {
            failed_items.push(ImportFailedItem {
                lot,
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some(format!(
                    "Could not convert ISBN: {} to Google Books ID",
                    isbn,
                )),
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
