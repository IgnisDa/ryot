use anyhow::Result;
use chrono::NaiveDate;
use common_utils::convert_naive_to_utc;
use convert_case::{Case, Casing};
use csv::Reader;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use dependent_provider_utils::get_identifier_from_book_isbn;
use enum_models::{ImportSource, MediaLot};
use google_books_provider::GoogleBooksService;
use hardcover_provider::HardcoverService;
use importer_models::{ImportFailStep, ImportFailedItem};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItemSeen,
};
use openlibrary_provider::OpenlibraryService;
use rust_decimal::{Decimal, dec};
use serde::{Deserialize, Serialize};

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
    hardcover_service: &HardcoverService,
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
        tracing::debug!("Details for {} ({idx}/{total})", record.title);
        let Some(isbn) = record.isbn else {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some("No ISBN found".to_owned()),
            });
            continue;
        };
        let Some((identifier, source)) = get_identifier_from_book_isbn(
            &isbn,
            hardcover_service,
            google_books_service,
            open_library_service,
        )
        .await
        else {
            failed.push(ImportFailedItem {
                lot: Some(lot),
                step: ImportFailStep::InputTransformation,
                identifier: record.title,
                error: Some(format!(
                    "Could not convert ISBN: {isbn} to any metadata provider"
                )),
            });
            continue;
        };
        tracing::debug!("Identifier = {identifier:?}, Source = {source:?}");
        let mut seen_history = vec![
            ImportOrExportMetadataItemSeen {
                providers_consumed_on: Some(vec![ImportSource::Storygraph.to_string()]),
                ..Default::default()
            };
            record.read_count
        ];
        if let Some(w) = record.last_date_read {
            let w = NaiveDate::parse_from_str(&w, "%Y/%m/%d").unwrap();
            seen_history.first_mut().unwrap().ended_on = Some(convert_naive_to_utc(w));
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
        let collections = collections
            .into_iter()
            .map(|name| CollectionToEntityDetails {
                collection_name: name,
                ..Default::default()
            })
            .collect();

        media.push(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            collections,
            seen_history,
            source_id: record.title.clone(),
            reviews: vec![ImportOrExportItemRating {
                rating: record
                    .rating
                    // DEV: Rates items out of 10
                    .map(|d| d.saturating_mul(dec!(10))),
                review: record.review.map(|r| ImportOrExportItemReview {
                    text: Some(r),
                    spoiler: Some(false),
                    ..Default::default()
                }),
                ..Default::default()
            }],
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
