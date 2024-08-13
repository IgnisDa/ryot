use async_graphql::Result;
use csv::Reader;
use enums::{MediaLot, MediaSource};
use itertools::Itertools;
use models::{DefaultCollection, ImportOrExportMediaItem};
pub use providers::tmdb::NonMediaTmdbService;
use serde::Deserialize;

use crate::importer::{
    DeployGenericCsvImportInput, ImportFailStep, ImportFailedItem, ImportResult,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    #[serde(rename = "Const")]
    id: String,
    #[serde(rename = "Title Type")]
    title_type: String,
}

pub async fn import(
    input: DeployGenericCsvImportInput,
    tmdb_service: &NonMediaTmdbService,
) -> Result<ImportResult> {
    let source = MediaSource::Tmdb;
    let mut media = vec![];
    let mut failed_items = vec![];
    let ratings_reader = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Item = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: idx.to_string(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        let lot = match record.title_type.as_str() {
            "Movie" | "Video" | "movie" | "video" => MediaLot::Movie,
            "TV Series" | "TV Mini Series" | "tvSeries" | "tvMiniSeries" => MediaLot::Show,
            tt => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    step: ImportFailStep::InputTransformation,
                    identifier: record.id.clone(),
                    error: Some(format!("Unknown title type: {tt}")),
                });
                continue;
            }
        };
        let identifier = match tmdb_service
            .find_by_external_id(&record.id, "imdb_id")
            .await
        {
            Ok(i) => i,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: Some(lot),
                    step: ImportFailStep::MediaDetailsFromProvider,
                    identifier: record.id.clone(),
                    error: Some(e.to_string()),
                });
                continue;
            }
        };
        tracing::debug!("Found tmdb id: {} ({}/{})", identifier, idx + 1, total);
        media.push(ImportOrExportMediaItem {
            identifier,
            lot,
            source,
            source_id: record.id,
            collections: vec![DefaultCollection::Watchlist.to_string()],
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
