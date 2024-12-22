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
    ImportOrExportMetadataItemSeen,
};
use providers::{google_books::GoogleBooksService, openlibrary::OpenlibraryService};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};

use super::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

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
    input: DeployGenericCsvImportInput,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Result<ImportResult> {
    let lot = MediaLot::Book;
    let mut media = vec![];
    let mut failed = vec![];
    let ratings_reader = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: History = match result {
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
        let Some(isbn) = record.isbn else {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some("No ISBN found".to_owned()),
            });
            continue;
        };
        let Some((identifier, source)) =
            get_identifier_from_book_isbn(&isbn, google_books_service, open_library_service).await
        else {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some(format!(
                    "Could not convert ISBN: {} to any metadata provider",
                    isbn
                )),
            });
            continue;
        };
        ryot_log!(
            debug,
            "Got identifier = {identifier:?} from source = {source:?}"
        );
        let mut seen_history = vec![
            ImportOrExportMetadataItemSeen {
                started_on: None,
                ended_on: None,
                provider_watched_on: Some(ImportSource::Storygraph.to_string()),
                ..Default::default()
            };
            record.read_count
        ];
        if let Some(w) = record.last_date_read {
            let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
            seen_history.first_mut().unwrap().ended_on = Some(w);
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
        media.push(ImportOrExportMetadataItem {
            source_id: record.title.clone(),
            lot,
            source,
            identifier,
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
    }
    Ok(ImportResult {
        failed,
        completed: media
            .into_iter()
            .map(ImportCompletedItem::Metadata)
            .collect(),
    })
}
