use async_graphql::Result;
use csv::Reader;
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use models::{
    DefaultCollection, DeployIgdbImportInput, ImportOrExportMediaItem, ImportOrExportMediaItemSeen,
};
use rust_decimal_macros::dec;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem, ImportResult};

#[derive(Debug, Deserialize)]
struct Item {
    id: String,
    game: String,
}

pub async fn import(input: DeployIgdbImportInput) -> Result<ImportResult> {
    let lot = MediaLot::VideoGame;
    let source = MediaSource::Igdb;
    let collection = input.collection;
    let mut media = vec![];
    let mut failed_items = vec![];
    let items = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let seen_history = if collection == DefaultCollection::Completed.to_string() {
        vec![ImportOrExportMediaItemSeen {
            ..Default::default()
        }]
    } else if collection == DefaultCollection::InProgress.to_string() {
        vec![ImportOrExportMediaItemSeen {
            progress: Some(dec!(5)),
            ..Default::default()
        }]
    } else {
        vec![]
    };
    for (idx, result) in items.into_iter().enumerate() {
        let record: Item = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        media.push(ImportOrExportMediaItem {
            lot,
            source,
            source_id: record.game,
            identifier: record.id,
            seen_history: seen_history.clone(),
            collections: vec![collection.clone()],
            reviews: vec![],
        });
    }
    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}
