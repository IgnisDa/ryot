use async_graphql::Result;
use common_models::DefaultCollection;
use common_utils::ryot_log;
use csv::Reader;
use dependent_models::ImportOrExportMetadataItem;
use dependent_models::{ImportCompletedItem, ImportResult};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::DeployGenericCsvImportInput;
pub use providers::tmdb::NonMediaTmdbService;
use serde::Deserialize;

use super::{ImportFailStep, ImportFailedItem};

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
    let mut completed = vec![];
    let mut failed = vec![];
    let ratings_reader = Reader::from_path(input.csv_path)
        .unwrap()
        .deserialize()
        .collect_vec();
    let total = ratings_reader.len();
    for (idx, result) in ratings_reader.into_iter().enumerate() {
        let record: Item = match result {
            Ok(r) => r,
            Err(e) => {
                failed.push(ImportFailedItem {
                    error: Some(e.to_string()),
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    ..Default::default()
                });
                continue;
            }
        };
        let lot = match record.title_type.as_str() {
            "Movie" | "Video" | "movie" | "video" => MediaLot::Movie,
            "TV Series" | "TV Mini Series" | "tvSeries" | "tvMiniSeries" => MediaLot::Show,
            tt => {
                failed.push(ImportFailedItem {
                    identifier: record.id.clone(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(format!("Unknown title type: {tt}")),
                    ..Default::default()
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
                failed.push(ImportFailedItem {
                    lot: Some(lot),
                    identifier: record.id.clone(),
                    step: ImportFailStep::ItemDetailsFromSource,
                    error: Some(format!("Could not fetch details from TMDB: {e}")),
                });
                continue;
            }
        };
        ryot_log!(
            debug,
            "Found tmdb id: {} ({}/{})",
            identifier,
            idx + 1,
            total
        );
        completed.push(ImportCompletedItem::Metadata(ImportOrExportMetadataItem {
            lot,
            source,
            identifier,
            source_id: record.id,
            collections: vec![DefaultCollection::Watchlist.to_string()],
            ..Default::default()
        }));
    }
    Ok(ImportResult { failed, completed })
}
