use async_graphql::Result;
use common_models::DefaultCollection;
use csv::Reader;
use dependent_models::{ImportCompletedItem, ImportResult};
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    DeployIgdbImportInput, ImportOrExportMetadataItem, ImportOrExportMetadataItemSeen,
};
use rust_decimal_macros::dec;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
struct Item {
    id: String,
    game: String,
}

pub async fn import(input: DeployIgdbImportInput) -> Result<ImportResult> {
    let lot = MediaLot::VideoGame;
    let source = MediaSource::Igdb;
    let collection = input.collection;
    let mut completed = vec![];
    let mut failed = vec![];
    let items = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let seen_history = if collection == DefaultCollection::Completed.to_string() {
        vec![ImportOrExportMetadataItemSeen {
            ..Default::default()
        }]
    } else if collection == DefaultCollection::InProgress.to_string() {
        vec![ImportOrExportMetadataItemSeen {
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
                failed.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier: record.id,
            source_id: record.game,
            seen_history: seen_history.clone(),
            collections: vec![collection.clone()],
            ..Default::default()
        }));
    }
    Ok(ImportResult {
        failed,
        completed,
        ..Default::default()
    })
}
