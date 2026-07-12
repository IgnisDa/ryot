use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufReader, Read},
    path::Path,
};

use anyhow::{Context, Result, bail};
use dependent_models::{CollectionToEntityDetails, ImportCompletedItem, ImportResult};
use enum_models::{ImportSource, MediaLot};
use importer_models::{ImportFailStep, ImportFailedItem};
use media_models::{
    CreateOrUpdateCollectionInput, ImportOrExportItemRating, ImportOrExportItemReview,
    ImportOrExportMetadataItemSeen,
};
use rust_decimal::dec;
use zip::ZipArchive;

use crate::{ListItemResponse, ListResponse, process_item, show_coordinates};

const MAX_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum FileKind {
    ListMetadata,
    History,
    Rating,
    Comment,
    Collection,
    SystemList,
    CustomList(u64),
}

#[derive(Debug)]
struct ArchiveEntry {
    index: usize,
    page: u64,
    name: String,
    kind: FileKind,
}

pub(super) fn import(export_path: &str) -> Result<ImportResult> {
    import_with_limits(export_path, MAX_ENTRY_BYTES, MAX_TOTAL_BYTES)
}

pub(super) fn import_with_limits(
    export_path: &str,
    max_entry_bytes: u64,
    max_total_bytes: u64,
) -> Result<ImportResult> {
    let file = File::open(export_path).context("Could not open Trakt export ZIP")?;
    let mut archive = ZipArchive::new(BufReader::new(file)).context("Invalid Trakt export ZIP")?;
    let mut entries = recognized_entries(&mut archive)?;
    if entries.is_empty() {
        bail!("Trakt export ZIP does not contain any recognized files");
    }
    entries.sort_by(|left, right| {
        (left.kind, left.page, &left.name).cmp(&(right.kind, right.page, &right.name))
    });

    let mut total_bytes = 0;
    let mut parsed = Vec::with_capacity(entries.len());
    for entry in entries {
        let bytes = read_entry(
            &mut archive,
            &entry,
            &mut total_bytes,
            max_entry_bytes,
            max_total_bytes,
        )?;
        parsed.push((entry, bytes));
    }
    convert_entries(parsed)
}

fn recognized_entries<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<Vec<ArchiveEntry>> {
    let mut entries = vec![];
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .context("Could not inspect Trakt export ZIP entry")?;
        let Some(name) = Path::new(entry.name())
            .file_name()
            .and_then(|name| name.to_str())
        else {
            continue;
        };
        if let Some((kind, page)) = classify_name(name) {
            entries.push(ArchiveEntry {
                kind,
                page,
                index,
                name: name.to_owned(),
            });
        }
    }
    Ok(entries)
}

fn classify_name(name: &str) -> Option<(FileKind, u64)> {
    if let Some(page) = numbered_page(name, "lists-lists") {
        return Some((FileKind::ListMetadata, page));
    }
    for media_type in ["movies", "shows", "seasons", "episodes"] {
        for (prefix, kind) in [
            ("ratings", FileKind::Rating),
            ("comments", FileKind::Comment),
        ] {
            if let Some(page) = numbered_page(name, &format!("{prefix}-{media_type}")) {
                return Some((kind, page));
            }
        }
    }
    for media_type in ["movies", "shows"] {
        if let Some(page) = numbered_page(name, &format!("collection-{media_type}")) {
            return Some((FileKind::Collection, page));
        }
    }
    if let Some(page) = numbered_page(name, "watched-history") {
        return Some((FileKind::History, page));
    }
    for list in ["watchlist", "favorites"] {
        if let Some(page) = numbered_page(name, &format!("lists-{list}")) {
            return Some((FileKind::SystemList, page));
        }
    }
    custom_list(name).map(|id| (FileKind::CustomList(id), 0))
}

fn numbered_page(name: &str, stem: &str) -> Option<u64> {
    let suffix = name.strip_prefix(stem)?.strip_suffix(".json")?;
    if suffix.is_empty() {
        Some(0)
    } else {
        suffix.strip_prefix('-')?.parse().ok()
    }
}

pub(super) fn custom_list(name: &str) -> Option<u64> {
    let remainder = name.strip_prefix("lists-list-")?.strip_suffix(".json")?;
    let (id, suffix) = remainder.split_once('-')?;
    if suffix.is_empty() {
        return None;
    }
    id.parse().ok()
}

fn read_entry<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    entry: &ArchiveEntry,
    total_bytes: &mut u64,
    max_entry_bytes: u64,
    max_total_bytes: u64,
) -> Result<Vec<u8>> {
    let mut bytes = vec![];
    let mut file = archive
        .by_index(entry.index)
        .with_context(|| format!("Could not read {}", entry.name))?;
    let total_remaining = max_total_bytes.saturating_sub(*total_bytes);
    let read_limit = max_entry_bytes.min(total_remaining);
    file.by_ref()
        .take(read_limit + 1)
        .read_to_end(&mut bytes)
        .with_context(|| format!("Could not decompress {}", entry.name))?;
    if bytes.len() as u64 > total_remaining {
        bail!("Trakt export exceeds total decompressed size limit");
    }
    if bytes.len() as u64 > max_entry_bytes {
        bail!(
            "Trakt export entry {} exceeds decompressed size limit",
            entry.name
        );
    }
    *total_bytes += bytes.len() as u64;
    Ok(bytes)
}

fn convert_entries(entries: Vec<(ArchiveEntry, Vec<u8>)>) -> Result<ImportResult> {
    let mut failed = vec![];
    let mut completed = vec![];
    let mut lists = HashMap::new();
    let mut created_collections = HashSet::new();

    for (entry, bytes) in entries {
        if entry.kind == FileKind::ListMetadata {
            let metadata: Vec<ListResponse> = parse_json(&entry.name, &bytes)?;
            for list in metadata {
                if let Some(id) = list.ids.trakt {
                    lists.insert(id, (list.name.clone(), list.description.clone()));
                }
                add_collection(
                    &mut completed,
                    &mut created_collections,
                    list.name,
                    list.description,
                );
            }
            continue;
        }

        let items: Vec<ListItemResponse> = parse_json(&entry.name, &bytes)?;
        match entry.kind {
            FileKind::History => import_history(items, &mut completed, &mut failed),
            FileKind::Rating => import_ratings(items, &mut completed, &mut failed),
            FileKind::Comment => import_comments(items, &mut completed, &mut failed),
            FileKind::Collection => import_collection(items, "Owned", &mut completed, &mut failed),
            FileKind::SystemList => {
                let name = if entry.name.contains("watchlist") {
                    "Watchlist"
                } else {
                    "Favorites"
                };
                add_collection(
                    &mut completed,
                    &mut created_collections,
                    name.to_owned(),
                    None,
                );
                import_collection(items, name, &mut completed, &mut failed);
            }
            FileKind::CustomList(id) => {
                let (name, description) = lists
                    .get(&id)
                    .cloned()
                    .unwrap_or_else(|| (format!("Trakt List {id}"), None));
                add_collection(
                    &mut completed,
                    &mut created_collections,
                    name.clone(),
                    description,
                );
                import_collection(items, &name, &mut completed, &mut failed);
            }
            FileKind::ListMetadata => unreachable!(),
        }
    }
    Ok(ImportResult { failed, completed })
}

fn parse_json<T: serde::de::DeserializeOwned>(name: &str, bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes)
        .with_context(|| format!("Invalid JSON in Trakt export entry {name}"))
}

fn import_history(
    mut items: Vec<ListItemResponse>,
    completed: &mut Vec<ImportCompletedItem>,
    failed: &mut Vec<ImportFailedItem>,
) {
    items.sort_by_key(|item| item.watched_at.unwrap_or_default());
    for item in items {
        let Some(watched_at) = item.watched_at else {
            failed.push(item_error(
                &item,
                "History item does not have a watched date",
            ));
            continue;
        };
        match process_item(&item) {
            Ok(mut metadata) => {
                let (season, episode) = show_coordinates(&item);
                if metadata.lot == MediaLot::Show && (season.is_none() || episode.is_none()) {
                    failed.push(item_error(
                        &item,
                        "Show history item has no episode coordinates",
                    ));
                    continue;
                }
                metadata.seen_history.push(ImportOrExportMetadataItemSeen {
                    ended_on: Some(watched_at),
                    show_season_number: season,
                    show_episode_number: episode,
                    providers_consumed_on: Some(vec![ImportSource::Trakt.to_string()]),
                    ..Default::default()
                });
                completed.push(ImportCompletedItem::Metadata(metadata));
            }
            Err(error) => failed.push(error),
        }
    }
}

fn import_ratings(
    items: Vec<ListItemResponse>,
    completed: &mut Vec<ImportCompletedItem>,
    failed: &mut Vec<ImportFailedItem>,
) {
    for item in items {
        match process_item(&item) {
            Ok(mut metadata) => {
                let (season, episode) = show_coordinates(&item);
                metadata.reviews.push(ImportOrExportItemRating {
                    show_season_number: season,
                    show_episode_number: episode,
                    rating: item.rating.map(|rating| rating * dec!(10)),
                    review: Some(ImportOrExportItemReview {
                        date: item.rated_at,
                        spoiler: Some(false),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                completed.push(ImportCompletedItem::Metadata(metadata));
            }
            Err(error) => failed.push(error),
        }
    }
}

fn import_comments(
    items: Vec<ListItemResponse>,
    completed: &mut Vec<ImportCompletedItem>,
    failed: &mut Vec<ImportFailedItem>,
) {
    for item in items {
        let Some(comment) = item.comment.as_ref() else {
            failed.push(item_error(
                &item,
                "Comment item does not contain comment data",
            ));
            continue;
        };
        match process_item(&item) {
            Ok(mut metadata) => {
                let (season, episode) = show_coordinates(&item);
                metadata.reviews.push(ImportOrExportItemRating {
                    show_season_number: season,
                    show_episode_number: episode,
                    review: Some(ImportOrExportItemReview {
                        text: Some(comment.comment.clone()),
                        date: Some(comment.created_at),
                        spoiler: Some(comment.spoiler),
                        ..Default::default()
                    }),
                    ..Default::default()
                });
                completed.push(ImportCompletedItem::Metadata(metadata));
            }
            Err(error) => failed.push(error),
        }
    }
}

fn import_collection(
    items: Vec<ListItemResponse>,
    name: &str,
    completed: &mut Vec<ImportCompletedItem>,
    failed: &mut Vec<ImportFailedItem>,
) {
    for item in items {
        match process_item(&item) {
            Ok(mut metadata) => {
                metadata.collections.push(CollectionToEntityDetails {
                    collection_name: name.to_owned(),
                    ..Default::default()
                });
                completed.push(ImportCompletedItem::Metadata(metadata));
            }
            Err(error) => failed.push(error),
        }
    }
}

fn add_collection(
    completed: &mut Vec<ImportCompletedItem>,
    created: &mut HashSet<String>,
    name: String,
    description: Option<String>,
) {
    if created.insert(name.clone()) {
        completed.push(ImportCompletedItem::Collection(
            CreateOrUpdateCollectionInput {
                name,
                description: description.filter(|value| !value.is_empty()),
                ..Default::default()
            },
        ));
    }
}

fn item_error(item: &ListItemResponse, message: &str) -> ImportFailedItem {
    ImportFailedItem {
        error: Some(message.to_owned()),
        identifier: format!("{item:#?}"),
        step: ImportFailStep::ItemDetailsFromSource,
        ..Default::default()
    }
}
