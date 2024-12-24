use async_graphql::Result;
use chrono::NaiveDate;
use common_utils::ryot_log;
use convert_case::{Case, Casing};
use csv::Reader;
use dependent_models::{ImportCompletedItem, ImportResult};
use dependent_utils::get_identifier_from_book_isbn;
use enum_models::{ImportSource, MediaLot};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use providers::{google_books::GoogleBooksService, openlibrary::OpenlibraryService};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
struct Book {
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
    input: DeployGenericCsvImportInput,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let lot = MediaLot::Book;
    let mut completed = vec![];
    let mut failed = vec![];
    let ratings_reader = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Book = match result {
            Ok(r) => r,
            Err(e) => {
                failed.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        ryot_log!(
            debug,
            "Getting details for {title:?} ({idx}/{total})",
            title = record.title
        );
        let isbn = record.isbn13[2..record.isbn13.len() - 1].to_owned();
        if isbn.is_empty() {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some("ISBN is empty".to_owned()),
            });
            continue;
        }
        let Some((identifier, source)) =
            get_identifier_from_book_isbn(&isbn, google_books_service, open_library_service).await
        else {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some(format!(
                    "Could not convert ISBN: {} to Google Books ID",
                    isbn,
                )),
            });
            continue;
        };
        let mut seen_history = vec![
            ImportOrExportMetadataItemSeen {
                provider_watched_on: Some(ImportSource::Goodreads.to_string()),
                ..Default::default()
            };
            record.read_count
        ];
        if let Some(w) = record.date_read {
            let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
            seen_history.first_mut().unwrap().ended_on = Some(w);
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
                spoiler: Some(false),
                text: Some(record.review),
                ..Default::default()
            });
        }
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            collections,
            seen_history,
            source_id: record.title.clone(),
            reviews: vec![ImportOrExportItemRating {
                review,
                rating,
                ..Default::default()
            }],
        }));
    }
    Ok(ImportResult { completed, failed })
}
