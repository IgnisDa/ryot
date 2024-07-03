use async_graphql::Result;
use csv::Reader;
use database::{MediaLot, MediaSource};
use itertools::Itertools;
use serde::Deserialize;

use crate::models::media::{ImportOrExportItemIdentifier, ImportOrExportMediaItem};

use super::{DeployIgdbImportInput, ImportFailStep, ImportFailedItem, ImportResult};

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
            collections: vec![collection.clone()],
            internal_identifier: Some(ImportOrExportItemIdentifier::NeedsDetails(record.id)),
            lot,
            source,
            source_id: record.game,
            identifier: "".to_string(),
            reviews: vec![],
            seen_history: vec![],
        });
    }
    Ok(ImportResult {
        media,
        failed_items,
        ..Default::default()
    })
}
