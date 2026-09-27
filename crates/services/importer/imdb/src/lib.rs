use anyhow::Result;
use chrono::NaiveDate;
use common_models::DefaultCollection;
use common_utils::{convert_naive_to_utc, ryot_log};
use csv::Reader;
use dependent_models::{
    CollectionToEntityDetails, ImportCompletedItem, ImportOrExportMetadataItem, ImportResult,
};
use enum_models::{ImportSource, MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    DeployGenericCsvImportInput, ImportOrExportItemRating, ImportOrExportMetadataItemSeen,
};
use rust_decimal::{Decimal, dec};
use serde::Deserialize;
use tmdb_provider::NonMediaTmdbService;

use importer_models::{ImportFailStep, ImportFailedItem};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Item {
    #[serde(rename = "Const")]
    id: String,
    #[serde(rename = "Title Type")]
    title_type: String,
    #[serde(default, rename = "Your Rating")]
    your_rating: Option<Decimal>,
    #[serde(default, rename = "Date Rated")]
    date_rated: Option<String>,
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
        ryot_log!(debug, "Tmdb id: {} ({}/{})", identifier, idx + 1, total);
        let item = match map_item_to_metadata(&record, lot, source, identifier) {
            Ok(item) => item,
            Err(e) => {
                failed.push(ImportFailedItem {
                    lot: Some(lot),
                    identifier: record.id.clone(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(e),
                });
                continue;
            }
        };
        completed.push(ImportCompletedItem::Metadata(item));
    }
    Ok(ImportResult { failed, completed })
}

fn map_item_to_metadata(
    record: &Item,
    lot: MediaLot,
    source: MediaSource,
    identifier: String,
) -> Result<ImportOrExportMetadataItem, String> {
    if let Some(r) = record.your_rating {
        if r < dec!(1) || r > dec!(10) {
            return Err(format!("Invalid rating '{r}', must be between 1 and 10"));
        }
    }
    let ended_on = if let Some(ref d) = record.date_rated {
        let trimmed = d.trim();
        if trimmed.is_empty() {
            None
        } else {
            let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
                .or_else(|_| NaiveDate::parse_from_str(trimmed, "%Y/%m/%d"))
                .map_err(|e| format!("Invalid date rated '{d}': {e}"))?;
            Some(convert_naive_to_utc(parsed))
        }
    } else {
        None
    };
    let is_watched = record.your_rating.is_some() || ended_on.is_some();
    let (collections, seen_history) = if is_watched {
        let seen_item = ImportOrExportMetadataItemSeen {
            ended_on,
            providers_consumed_on: Some(vec![ImportSource::Imdb.to_string()]),
            ..Default::default()
        };
        (vec![], vec![seen_item])
    } else {
        (
            vec![CollectionToEntityDetails {
                collection_name: DefaultCollection::Watchlist.to_string(),
                ..Default::default()
            }],
            vec![],
        )
    };
    let reviews = match record.your_rating {
        Some(r) => vec![ImportOrExportItemRating {
            // DEV: Rates items out of 10
            rating: Some(r.saturating_mul(dec!(10))),
            ..Default::default()
        }],
        None => vec![],
    };
    Ok(ImportOrExportMetadataItem {
        lot,
        source,
        identifier,
        source_id: record.id.clone(),
        collections,
        seen_history,
        reviews,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_ratings_csv() {
        let csv = "Const,Your Rating,Date Rated,Title Type\ntt0111161,9,2023-08-15,movie\n";
        let mut reader = Reader::from_reader(csv.as_bytes());
        let item: Item = reader.deserialize().next().unwrap().unwrap();
        assert_eq!(item.id, "tt0111161");
        assert_eq!(item.title_type, "movie");
        assert_eq!(item.your_rating, Some(dec!(9)));
        assert_eq!(item.date_rated, Some("2023-08-15".to_string()));
    }

    #[test]
    fn test_deserialize_watchlist_csv_without_rating_columns() {
        let csv = "Const,Title Type\ntt0111161,movie\n";
        let mut reader = Reader::from_reader(csv.as_bytes());
        let item: Item = reader.deserialize().next().unwrap().unwrap();
        assert_eq!(item.id, "tt0111161");
        assert_eq!(item.title_type, "movie");
        assert_eq!(item.your_rating, None);
        assert_eq!(item.date_rated, None);
    }

    #[test]
    fn test_map_item_to_metadata_watched_with_rating_and_date() {
        let item = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: Some(dec!(9)),
            date_rated: Some("2023-08-15".to_string()),
        };
        let metadata =
            map_item_to_metadata(&item, MediaLot::Movie, MediaSource::Tmdb, "123".to_string())
                .unwrap();
        assert!(metadata.collections.is_empty());
        assert_eq!(metadata.seen_history.len(), 1);
        assert_eq!(
            metadata.seen_history[0].providers_consumed_on,
            Some(vec![ImportSource::Imdb.to_string()])
        );
        assert!(metadata.seen_history[0].ended_on.is_some());
        assert_eq!(metadata.reviews.len(), 1);
        assert_eq!(metadata.reviews[0].rating, Some(dec!(90)));
    }

    #[test]
    fn test_map_item_to_metadata_watchlist() {
        let item = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: None,
            date_rated: None,
        };
        let metadata =
            map_item_to_metadata(&item, MediaLot::Movie, MediaSource::Tmdb, "123".to_string())
                .unwrap();
        assert_eq!(metadata.collections.len(), 1);
        assert_eq!(
            metadata.collections[0].collection_name,
            DefaultCollection::Watchlist.to_string()
        );
        assert!(metadata.seen_history.is_empty());
        assert!(metadata.reviews.is_empty());
    }

    #[test]
    fn test_map_item_to_metadata_watched_without_rating() {
        let item = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: None,
            date_rated: Some("2023-08-15".to_string()),
        };
        let metadata =
            map_item_to_metadata(&item, MediaLot::Movie, MediaSource::Tmdb, "123".to_string())
                .unwrap();
        assert!(metadata.collections.is_empty());
        assert_eq!(metadata.seen_history.len(), 1);
        assert!(metadata.reviews.is_empty());
    }

    #[test]
    fn test_map_item_to_metadata_invalid_rating() {
        let item_zero = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: Some(dec!(0)),
            date_rated: None,
        };
        assert!(
            map_item_to_metadata(
                &item_zero,
                MediaLot::Movie,
                MediaSource::Tmdb,
                "123".to_string()
            )
            .is_err()
        );

        let item_eleven = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: Some(dec!(11)),
            date_rated: None,
        };
        assert!(
            map_item_to_metadata(
                &item_eleven,
                MediaLot::Movie,
                MediaSource::Tmdb,
                "123".to_string()
            )
            .is_err()
        );
    }

    #[test]
    fn test_map_item_to_metadata_invalid_date() {
        let item_bad_date = Item {
            id: "tt0111161".to_string(),
            title_type: "movie".to_string(),
            your_rating: None,
            date_rated: Some("not-a-date".to_string()),
        };
        assert!(
            map_item_to_metadata(
                &item_bad_date,
                MediaLot::Movie,
                MediaSource::Tmdb,
                "123".to_string()
            )
            .is_err()
        );
    }
}
