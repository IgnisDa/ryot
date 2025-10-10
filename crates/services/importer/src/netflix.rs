use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, BufReader},
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Result, bail};
use chrono::{DateTime, NaiveDateTime, Utc};
use common_models::DefaultCollection;
use common_utils::ryot_log;
use csv::Reader;
use dependent_models::{CollectionToEntityDetails, ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot, MediaSource};
use futures::stream::{self, StreamExt};
use indexmap::IndexMap;
use media_models::{
    DeployNetflixImportInput, ImportOrExportItemRating, ImportOrExportMetadataItemSeen,
    MetadataLookupResponse,
};
use miscellaneous_lookup_service::metadata_lookup;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::Deserialize;
use supporting_service::SupportingService;
use tempfile::TempDir;
use zip::ZipArchive;

use crate::{ImportFailStep, ImportFailedItem, ImportOrExportMetadataItem};

const METADATA_LOOKUP_CONCURRENCY: usize = 20;

#[derive(Debug, Clone)]
struct LookupCacheItem {
    lot: MediaLot,
    identifier: String,
    season: Option<i32>,
    source: MediaSource,
    episode: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ViewingActivityItem {
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "Bookmark")]
    bookmark: String,
    #[serde(rename = "Duration")]
    duration: String,
    #[serde(rename = "Start Time")]
    start_time: String,
    #[serde(rename = "Attributes")]
    attributes: String,
    #[serde(rename = "Profile Name")]
    profile_name: String,
    #[serde(rename = "Latest Bookmark")]
    latest_bookmark: String,
    #[serde(rename = "Supplemental Video Type")]
    supplemental_video_type: String,
}

#[derive(Debug, Deserialize)]
struct RatingItem {
    #[serde(rename = "Title Name")]
    title_name: String,
    #[serde(rename = "Profile Name")]
    profile_name: String,
    #[serde(rename = "Event Utc Ts")]
    event_utc_ts: String,
    #[serde(rename = "Star Value")]
    star_value: Option<i32>,
    #[serde(rename = "Thumbs Value")]
    thumbs_value: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct MyListItem {
    #[serde(rename = "Title Name")]
    title_name: String,
    #[serde(rename = "Profile Name")]
    profile_name: String,
}

fn should_skip_entry(item: &ViewingActivityItem) -> bool {
    if !item.supplemental_video_type.is_empty() {
        return true;
    }
    if item.latest_bookmark == "Not latest view" {
        return true;
    }
    if item.attributes.contains("Autoplayed: user action: None;") {
        return true;
    }
    if item.title.contains("_hook_")
        || item.title.contains("Clip:")
        || item.title.contains("Trailer:")
        || item.title.contains("_backfill")
    {
        return true;
    }
    false
}

fn matches_profile_filter(profile_name: &str, filter: &Option<String>) -> bool {
    match filter {
        Some(filter_name) if !filter_name.is_empty() => profile_name == filter_name,
        _ => true,
    }
}

fn parse_time_to_seconds(time_str: &str) -> Option<i32> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: i32 = parts[0].parse().ok()?;
    let minutes: i32 = parts[1].parse().ok()?;
    let seconds: i32 = parts[2].parse().ok()?;
    Some(hours * 3600 + minutes * 60 + seconds)
}

fn convert_rating(thumbs: Option<i32>, stars: Option<i32>) -> Option<Decimal> {
    match (stars, thumbs) {
        (Some(star_value), _) => match star_value {
            1..=5 => Some(Decimal::from(star_value * 20)),
            _ => None,
        },
        (None, Some(thumbs_value)) => match thumbs_value {
            0 => None,
            1 => Some(dec!(33)),
            2 => Some(dec!(67)),
            3 => Some(dec!(100)),
            _ => None,
        },
        (None, None) => None,
    }
}

fn parse_netflix_timestamp(timestamp: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(timestamp, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|ndt| DateTime::<Utc>::from_naive_utc_and_offset(ndt, Utc))
}

fn extract_zip(zip_path: &str) -> Result<TempDir> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(BufReader::new(file))?;
    let temp_dir = TempDir::new()?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let output_path = temp_dir.path().join(file.mangled_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&output_path)?;
        } else {
            if let Some(p) = output_path.parent()
                && !p.exists()
            {
                fs::create_dir_all(p)?;
            }
            let mut output_file = File::create(&output_path)?;
            io::copy(&mut file, &mut output_file)?;
        }
    }

    Ok(temp_dir)
}

fn find_content_interaction_dir(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let candidate = dir.join("CONTENT_INTERACTION");
        if candidate.is_dir() {
            return Some(candidate);
        }

        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            }
        }
    }

    None
}

async fn lookup_title(
    ss: &Arc<SupportingService>,
    title: &str,
) -> (Option<LookupCacheItem>, Option<ImportFailedItem>) {
    let lookup_result = metadata_lookup(ss, title.to_string()).await;
    match lookup_result {
        Ok(result) => match result.response {
            MetadataLookupResponse::Found(found) => (
                Some(LookupCacheItem {
                    lot: found.data.lot,
                    source: found.data.source,
                    identifier: found.data.identifier,
                    season: found.show_information.as_ref().map(|s| s.season),
                    episode: found.show_information.as_ref().map(|s| s.episode),
                }),
                None,
            ),
            MetadataLookupResponse::NotFound(_) => (
                None,
                Some(ImportFailedItem {
                    lot: None,
                    identifier: title.to_string(),
                    step: ImportFailStep::ItemDetailsFromSource,
                    error: Some("Metadata not found".to_string()),
                }),
            ),
        },
        Err(e) => (
            None,
            Some(ImportFailedItem {
                lot: None,
                identifier: title.to_string(),
                step: ImportFailStep::ItemDetailsFromSource,
                error: Some(format!("Metadata lookup error: {e:#?}")),
            }),
        ),
    }
}

fn media_map_entry<'a>(
    media_map: &'a mut IndexMap<String, ImportOrExportMetadataItem>,
    lookup: &LookupCacheItem,
    source_id: &str,
) -> &'a mut ImportOrExportMetadataItem {
    let key = format!(
        "{}:{}:{}",
        lookup.identifier,
        lookup.season.unwrap_or(0),
        lookup.episode.unwrap_or(0)
    );

    media_map
        .entry(key)
        .or_insert_with(|| ImportOrExportMetadataItem {
            lot: lookup.lot,
            source: lookup.source,
            source_id: source_id.to_string(),
            identifier: lookup.identifier.clone(),
            ..Default::default()
        })
}

pub async fn import(
    input: DeployNetflixImportInput,
    ss: &Arc<SupportingService>,
) -> Result<ImportResult> {
    ryot_log!(debug, "Netflix import from: {}", input.input.export_path);

    let _extracted_dir = extract_zip(&input.input.export_path)?;
    let extracted_path = _extracted_dir.path();
    ryot_log!(debug, "Extracted ZIP to: {:?}", extracted_path);

    let Some(content_dir) = find_content_interaction_dir(extracted_path) else {
        bail!("CONTENT_INTERACTION folder not found in Netflix export");
    };

    let my_list_path = content_dir.join("MyList.csv");
    let ratings_path = content_dir.join("Ratings.csv");
    let viewing_activity_path = content_dir.join("ViewingActivity.csv");

    let mut failed_items = vec![];
    let mut rating_items: Vec<RatingItem> = vec![];
    let mut my_list_items: Vec<MyListItem> = vec![];
    let mut viewing_items: Vec<ViewingActivityItem> = vec![];
    let mut media_map: IndexMap<String, ImportOrExportMetadataItem> = IndexMap::new();

    ryot_log!(debug, "Processing ViewingActivity.csv");
    let mut reader = Reader::from_path(&viewing_activity_path)?;

    for (idx, result) in reader.deserialize().enumerate() {
        let record: ViewingActivityItem = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(format!("ViewingActivity CSV parsing error: {e:#?}")),
                });
                continue;
            }
        };

        if should_skip_entry(&record) {
            continue;
        }

        if !matches_profile_filter(&record.profile_name, &input.profile_name) {
            continue;
        }

        viewing_items.push(record);
    }

    ryot_log!(
        debug,
        "Processing {} viewing activity entries",
        viewing_items.len()
    );

    ryot_log!(debug, "Processing Ratings.csv");
    let mut reader = Reader::from_path(&ratings_path)?;

    for (idx, result) in reader.deserialize().enumerate() {
        let record: RatingItem = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(format!("Ratings CSV parsing error: {e:#?}")),
                });
                continue;
            }
        };

        if !matches_profile_filter(&record.profile_name, &input.profile_name) {
            continue;
        }

        rating_items.push(record);
    }

    ryot_log!(debug, "Processing MyList.csv");
    let mut reader = Reader::from_path(&my_list_path)?;

    for (idx, result) in reader.deserialize().enumerate() {
        let record: MyListItem = match result {
            Ok(r) => r,
            Err(e) => {
                failed_items.push(ImportFailedItem {
                    lot: None,
                    identifier: idx.to_string(),
                    step: ImportFailStep::InputTransformation,
                    error: Some(format!("MyList CSV parsing error: {e:#?}")),
                });
                continue;
            }
        };

        if !matches_profile_filter(&record.profile_name, &input.profile_name) {
            continue;
        }

        my_list_items.push(record);
    }

    let mut title_cache: HashMap<String, Option<LookupCacheItem>> = HashMap::new();

    let mut titles_to_lookup: HashSet<String> = HashSet::new();

    for item in &viewing_items {
        titles_to_lookup.insert(item.title.clone());
    }
    for item in &rating_items {
        titles_to_lookup.insert(item.title_name.clone());
    }
    for item in &my_list_items {
        titles_to_lookup.insert(item.title_name.clone());
    }

    let titles: Vec<String> = titles_to_lookup.into_iter().collect();
    ryot_log!(
        debug,
        "Running metadata lookups for {} titles",
        titles.len()
    );

    let lookup_results = stream::iter(titles.into_iter().map(|title| async move {
        let (lookup, failure) = lookup_title(ss, &title).await;
        (title, lookup, failure)
    }))
    .buffer_unordered(METADATA_LOOKUP_CONCURRENCY)
    .collect::<Vec<_>>()
    .await;

    for (title, lookup, failure) in lookup_results {
        if let Some(failure) = failure {
            failed_items.push(failure);
        }
        title_cache.insert(title, lookup);
    }

    for (idx, record) in viewing_items.into_iter().enumerate() {
        if idx % 100 == 0 {
            ryot_log!(debug, "Processed {idx} viewing entries");
        }

        let lookup = title_cache
            .get(&record.title)
            .and_then(|cached| cached.clone());

        if let Some(lookup) = lookup {
            let ended_on = parse_netflix_timestamp(&record.start_time);
            let bookmark_seconds = parse_time_to_seconds(&record.bookmark);
            let duration_seconds = parse_time_to_seconds(&record.duration);

            let progress = match (bookmark_seconds, duration_seconds) {
                (Some(bookmark), Some(duration)) if duration > 0 => {
                    Some((Decimal::from(bookmark) * dec!(100)) / Decimal::from(duration))
                }
                _ => None,
            };

            let seen_item = ImportOrExportMetadataItemSeen {
                ended_on,
                progress,
                show_season_number: lookup.season,
                show_episode_number: lookup.episode,
                providers_consumed_on: Some(vec![ImportSource::Netflix.to_string()]),
                ..Default::default()
            };

            media_map_entry(&mut media_map, &lookup, &record.title)
                .seen_history
                .push(seen_item);
        } else {
            failed_items.push(ImportFailedItem {
                lot: None,
                identifier: record.title.clone(),
                step: ImportFailStep::ItemDetailsFromSource,
                error: Some("Metadata not found".to_string()),
            });
        }
    }

    for record in rating_items.into_iter() {
        let rating_value = convert_rating(record.thumbs_value, record.star_value);
        if rating_value.is_none() {
            continue;
        }

        let lookup = title_cache
            .get(&record.title_name)
            .and_then(|cached| cached.clone());

        if let Some(lookup) = lookup {
            let review_date = parse_netflix_timestamp(&record.event_utc_ts);
            let rating = ImportOrExportItemRating {
                rating: rating_value,
                review: Some(media_models::ImportOrExportItemReview {
                    date: review_date,
                    spoiler: Some(false),
                    ..Default::default()
                }),
                ..Default::default()
            };

            media_map_entry(&mut media_map, &lookup, &record.title_name)
                .reviews
                .push(rating);
        } else {
            failed_items.push(ImportFailedItem {
                lot: None,
                identifier: record.title_name.clone(),
                step: ImportFailStep::ItemDetailsFromSource,
                error: Some("Metadata not found".to_string()),
            });
        }
    }

    for record in my_list_items.into_iter() {
        let lookup = title_cache
            .get(&record.title_name)
            .and_then(|cached| cached.clone());

        if let Some(lookup) = lookup {
            media_map_entry(&mut media_map, &lookup, &record.title_name)
                .collections
                .push(CollectionToEntityDetails {
                    collection_name: DefaultCollection::Watchlist.to_string(),
                    ..Default::default()
                });
        } else {
            failed_items.push(ImportFailedItem {
                lot: None,
                identifier: record.title_name.clone(),
                step: ImportFailStep::ItemDetailsFromSource,
                error: Some("Metadata not found".to_string()),
            });
        }
    }

    ryot_log!(
        debug,
        "Netflix import completed with {} items",
        media_map.len()
    );

    Ok(ImportResult {
        failed: failed_items,
        completed: media_map
            .into_values()
            .map(ImportCompletedItem::Metadata)
            .collect(),
    })
}
