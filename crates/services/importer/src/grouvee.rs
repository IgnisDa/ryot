use std::{collections::HashMap, result::Result as StdResult};

use anyhow::Result;
use chrono::{DateTime, Utc};
use common_models::DefaultCollection;
use common_utils::ryot_log;
use csv::Reader;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{ImportSource, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItemSeen,
};
use rust_decimal::Decimal;
use serde::Deserialize;

use crate::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
struct GrouveeGame {
    id: String,
    name: String,
    dates: String,
    shelves: String,
    statuses: String,
    review: Option<String>,
    rating: Option<Decimal>,
    giantbomb_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ShelfEntry {}

#[derive(Debug, Deserialize)]
struct DateEntry {
    seconds_played: Option<i32>,
    date_started: Option<String>,
    date_finished: Option<String>,
}

#[derive(Debug, Deserialize)]
struct StatusEntry {
    date: Option<String>,
    status: Option<String>,
}

pub async fn import(input: DeployGenericCsvImportInput) -> Result<ImportResult> {
    let lot = MediaLot::VideoGame;
    let ratings_reader = Reader::from_path(input.csv_path)?
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();

    let results: Vec<_> = ratings_reader
        .into_iter()
        .enumerate()
        .map(|(idx, result)| process_grouvee_record(idx, result, total, lot))
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

fn process_grouvee_record(
    idx: usize,
    result: csv::Result<GrouveeGame>,
    total: usize,
    lot: MediaLot,
) -> StdResult<ImportCompletedItem, ImportFailedItem> {
    let record: GrouveeGame = match result {
        Ok(r) => r,
        Err(e) => {
            return Err(ImportFailedItem {
                lot: Some(lot),
                error: Some(e.to_string()),
                identifier: idx.to_string(),
                step: ImportFailStep::InputTransformation,
            });
        }
    };

    ryot_log!(debug, "Processing {}/{}: {}", idx + 1, total, record.name);

    let Some(giantbomb_id) = record.giantbomb_id else {
        return Err(ImportFailedItem {
            lot: Some(lot),
            identifier: record.name.clone(),
            step: ImportFailStep::InputTransformation,
            error: Some("No giantbomb_id found".to_string()),
        });
    };

    if giantbomb_id.is_empty() {
        return Err(ImportFailedItem {
            lot: Some(lot),
            identifier: record.name.clone(),
            error: Some("Empty giantbomb_id".to_string()),
            step: ImportFailStep::InputTransformation,
        });
    }

    let source = MediaSource::GiantBomb;
    let identifier = format!("3030-{giantbomb_id}"); // since we store giant bomb guid

    let collections = parse_shelves(&record.shelves);

    let mut reviews = vec![];

    if let Ok(statuses) = parse_statuses(&record.statuses) {
        for status in statuses {
            if let Some(status_text) = status.status {
                reviews.push(ImportOrExportItemRating {
                    review: Some(ImportOrExportItemReview {
                        text: Some(status_text),
                        date: status.date.and_then(|d| parse_date(&d)),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            }
        }
    }

    if record.rating.is_some() || record.review.is_some() {
        reviews.push(ImportOrExportItemRating {
            rating: record.rating.map(|r| r * Decimal::from(20)),
            review: record.review.map(|text| ImportOrExportItemReview {
                text: Some(text),
                ..Default::default()
            }),
            ..Default::default()
        });
    }

    let mut seen_history = parse_dates(&record.dates);

    if seen_history.is_empty() {
        let is_completed = collections
            .iter()
            .any(|c| c.collection_name == DefaultCollection::Completed.to_string());
        if is_completed {
            seen_history.push(ImportOrExportMetadataItemSeen {
                providers_consumed_on: Some(vec![ImportSource::Grouvee.to_string()]),
                ..Default::default()
            });
        }
    }

    let item = ImportOrExportMetadataItem {
        lot,
        source,
        reviews,
        identifier,
        collections,
        seen_history,
        source_id: record.id,
    };

    Ok(ImportCompletedItem::Metadata(item))
}

fn parse_shelves(shelves_str: &str) -> Vec<CollectionToEntityDetails> {
    if shelves_str.is_empty() || shelves_str == "{}" {
        return vec![];
    }

    let shelves: Result<HashMap<String, ShelfEntry>, _> = serde_json::from_str(shelves_str);
    match shelves {
        Ok(shelf_map) => shelf_map
            .keys()
            .map(|shelf_name| {
                let collection_name = match shelf_name.as_str() {
                    "Played" => DefaultCollection::Completed.to_string(),
                    "Playing" => DefaultCollection::InProgress.to_string(),
                    "Wish List" => DefaultCollection::Watchlist.to_string(),
                    _ => shelf_name.clone(),
                };
                CollectionToEntityDetails {
                    collection_name,
                    ..Default::default()
                }
            })
            .collect(),
        Err(_) => vec![],
    }
}

fn parse_statuses(statuses_str: &str) -> Result<Vec<StatusEntry>, serde_json::Error> {
    if statuses_str.is_empty() || statuses_str == "[]" {
        return Ok(vec![]);
    }

    let statuses: Result<Vec<serde_json::Value>, _> = serde_json::from_str(statuses_str);
    match statuses {
        Ok(status_array) => {
            let mut parsed_statuses = vec![];
            for status_value in status_array {
                if let Some(status_obj) = status_value.as_object() {
                    let status_text = status_obj
                        .get("status")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let date = status_obj
                        .get("date")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    parsed_statuses.push(StatusEntry {
                        date,
                        status: status_text,
                    });
                }
            }
            Ok(parsed_statuses)
        }
        Err(e) => Err(e),
    }
}

fn parse_dates(dates_str: &str) -> Vec<ImportOrExportMetadataItemSeen> {
    if dates_str.is_empty() || dates_str == "[]" {
        return vec![];
    }

    let dates: Result<Vec<DateEntry>, _> = serde_json::from_str(dates_str);
    match dates {
        Ok(date_entries) => date_entries
            .into_iter()
            .filter_map(
                |entry| match (entry.date_finished.as_ref(), entry.seconds_played) {
                    (Some(_), _) | (_, Some(_)) => Some(ImportOrExportMetadataItemSeen {
                        providers_consumed_on: Some(vec![ImportSource::Grouvee.to_string()]),
                        started_on: entry.date_started.and_then(|d| parse_date(&d)),
                        ended_on: entry.date_finished.and_then(|d| parse_date(&d)),
                        ..Default::default()
                    }),
                    _ => None,
                },
            )
            .collect(),
        Err(_) => vec![],
    }
}

fn parse_date(date_str: &str) -> Option<DateTime<Utc>> {
    if date_str == "None" || date_str.is_empty() {
        return None;
    }

    if let Ok(dt) = DateTime::parse_from_rfc3339(date_str) {
        return Some(dt.with_timezone(&Utc));
    }

    if let Ok(dt) = DateTime::parse_from_str(date_str, "%Y-%m-%d") {
        return Some(dt.with_timezone(&Utc));
    }

    None
}
