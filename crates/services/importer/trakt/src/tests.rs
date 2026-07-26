use std::io::Write;

use dependent_models::ImportCompletedItem;
use enum_models::MediaLot;
use serde_json::{Value, json};
use tempfile::NamedTempFile;
use zip::{ZipWriter, write::SimpleFileOptions};

use super::export;

fn archive(files: &[(&str, Value)]) -> NamedTempFile {
    let file = NamedTempFile::new().unwrap();
    let mut writer = ZipWriter::new(file.reopen().unwrap());
    for (name, value) in files {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(value.to_string().as_bytes()).unwrap();
    }
    writer.finish().unwrap();
    file
}

fn movie(trakt: u64, tmdb: u64) -> Value {
    json!({ "movie": { "ids": { "trakt": trakt, "tmdb": tmdb } } })
}

fn show(trakt: u64, tmdb: u64) -> Value {
    json!({ "show": { "ids": { "trakt": trakt, "tmdb": tmdb } } })
}

fn season(trakt: u64, tmdb: u64, number: i32) -> Value {
    json!({
        "show": { "ids": { "trakt": trakt, "tmdb": tmdb } },
        "season": {
            "number": number,
            "ids": { "trakt": trakt + 100, "tmdb": tmdb + 100 }
        }
    })
}

fn episode(trakt: u64, tmdb: u64, season: i32, number: i32) -> Value {
    json!({
        "show": { "ids": { "trakt": trakt, "tmdb": tmdb } },
        "episode": {
            "season": season,
            "number": number,
            "ids": { "trakt": trakt + 100, "tmdb": tmdb + 100 }
        }
    })
}

fn rating(mut item: Value, rating: i32) -> Value {
    item["rating"] = json!(rating);
    item["rated_at"] = json!("2024-02-01T00:00:00Z");
    item
}

fn comment(mut item: Value, text: &str, spoiler: bool) -> Value {
    item["comment"] = json!({
        "comment": text,
        "spoiler": spoiler,
        "created_at": "2024-02-02T00:00:00Z"
    });
    item
}

fn metadata(
    result: &dependent_models::ImportResult,
) -> Vec<&dependent_models::ImportOrExportMetadataItem> {
    result
        .completed
        .iter()
        .filter_map(|item| match item {
            ImportCompletedItem::Metadata(metadata) => Some(metadata),
            _ => None,
        })
        .collect()
}

fn metadata_by_source<'a>(
    result: &'a dependent_models::ImportResult,
    source_id: &str,
) -> &'a dependent_models::ImportOrExportMetadataItem {
    metadata(result)
        .into_iter()
        .find(|item| item.source_id == source_id)
        .unwrap()
}

#[test]
fn sorts_numbered_pages_numerically() {
    let page_two = json!([{ "rating": 4, "rated_at": "2024-01-01T00:00:00Z", "movie": movie(2, 102)["movie"] }]);
    let page_ten = json!([{ "rating": 3, "rated_at": "2024-01-01T00:00:00Z", "movie": movie(10, 110)["movie"] }]);
    let file = archive(&[
        ("ratings-movies-10.json", page_ten),
        ("ratings-movies-2.json", page_two),
    ]);

    let result = export::import(file.path().to_str().unwrap()).unwrap();
    let items = metadata(&result);
    assert_eq!(items[0].source_id, "2");
    assert_eq!(items[1].source_id, "10");
}

#[test]
fn imports_movie_and_episode_history() {
    let mut movie = movie(1, 101);
    movie["watched_at"] = json!("2024-01-01T00:00:00Z");
    let mut episode = episode(2, 102, 3, 4);
    episode["watched_at"] = json!("2024-01-02T00:00:00Z");
    let file = archive(&[("watched-history.json", json!([movie, episode]))]);

    let result = export::import(file.path().to_str().unwrap()).unwrap();
    let items = metadata(&result);
    assert!(result.failed.is_empty());
    assert_eq!(items[0].lot, MediaLot::Movie);
    assert_eq!(items[1].seen_history[0].show_season_number, Some(3));
    assert_eq!(items[1].seen_history[0].show_episode_number, Some(4));
    assert_eq!(
        items[1].seen_history[0]
            .providers_consumed_on
            .as_ref()
            .unwrap(),
        &["Trakt"]
    );
}

#[test]
fn imports_ratings_and_comments_with_target_coordinates() {
    let file = archive(&[
        ("ratings-movies.json", json!([rating(movie(1, 101), 1)])),
        ("ratings-shows.json", json!([rating(show(2, 102), 2)])),
        (
            "ratings-seasons.json",
            json!([rating(season(3, 103, 3), 3)]),
        ),
        (
            "ratings-episodes.json",
            json!([rating(episode(4, 104, 4, 5), 4)]),
        ),
        (
            "comments-movies.json",
            json!([comment(movie(11, 111), "Movie review", false)]),
        ),
        (
            "comments-shows.json",
            json!([comment(show(12, 112), "Show review", true)]),
        ),
        (
            "comments-seasons.json",
            json!([comment(season(13, 113, 6), "Season review", false)]),
        ),
        (
            "comments-episodes.json",
            json!([comment(episode(14, 114, 7, 8), "Episode review", true)]),
        ),
    ]);

    let result = export::import(file.path().to_str().unwrap()).unwrap();
    assert!(result.failed.is_empty());
    for (source_id, score, season, episode) in [
        ("1", "10", None, None),
        ("2", "20", None, None),
        ("3", "30", Some(3), None),
        ("4", "40", Some(4), Some(5)),
    ] {
        let rating = &metadata_by_source(&result, source_id).reviews[0];
        assert_eq!(rating.rating.unwrap().to_string(), score);
        assert_eq!(rating.show_season_number, season);
        assert_eq!(rating.show_episode_number, episode);
        assert_eq!(
            rating.review.as_ref().unwrap().date.unwrap().to_rfc3339(),
            "2024-02-01T00:00:00+00:00"
        );
    }
    for (source_id, text, spoiler, season, episode) in [
        ("11", "Movie review", false, None, None),
        ("12", "Show review", true, None, None),
        ("13", "Season review", false, Some(6), None),
        ("14", "Episode review", true, Some(7), Some(8)),
    ] {
        let comment = &metadata_by_source(&result, source_id).reviews[0];
        let review = comment.review.as_ref().unwrap();
        assert_eq!(review.text.as_deref(), Some(text));
        assert_eq!(review.spoiler, Some(spoiler));
        assert_eq!(comment.show_season_number, season);
        assert_eq!(comment.show_episode_number, episode);
        assert_eq!(
            review.date.unwrap().to_rfc3339(),
            "2024-02-02T00:00:00+00:00"
        );
    }
}

#[test]
fn imports_system_custom_and_owned_collections() {
    let list_metadata = json!([{
        "name": "My Custom List",
        "description": "Custom description",
        "ids": { "trakt": 42 }
    }]);
    let file = archive(&[
        ("lists-lists.json", list_metadata),
        ("lists-watchlist.json", json!([movie(1, 101)])),
        ("lists-favorites.json", json!([movie(2, 102)])),
        ("lists-list-42-top-100.json", json!([movie(3, 103)])),
        ("collection-movies.json", json!([movie(4, 104)])),
    ]);

    let result = export::import(file.path().to_str().unwrap()).unwrap();
    let items = metadata(&result);
    let names = items
        .iter()
        .map(|item| item.collections[0].collection_name.as_str())
        .collect::<Vec<_>>();
    assert!(names.contains(&"Watchlist"));
    assert!(names.contains(&"Favorites"));
    assert!(names.contains(&"My Custom List"));
    assert!(names.contains(&"Owned"));
    assert_eq!(export::custom_list("lists-list-42-top-100.json"), Some(42));
    assert!(result.completed.iter().any(|item| matches!(
        item,
        ImportCompletedItem::Collection(collection)
            if collection.name == "My Custom List"
                && collection.description.as_deref() == Some("Custom description")
    )));
}

#[test]
fn rejects_invalid_malformed_and_unrecognized_archives() {
    let invalid = NamedTempFile::new().unwrap();
    invalid.as_file().write_all(b"not a zip").unwrap();
    assert!(export::import(invalid.path().to_str().unwrap()).is_err());

    let malformed = archive(&[("ratings-movies.json", json!({ "not": "an array" }))]);
    assert!(export::import(malformed.path().to_str().unwrap()).is_err());

    let unrecognized = archive(&[("profile.json", json!({}))]);
    assert!(export::import(unrecognized.path().to_str().unwrap()).is_err());
}

#[test]
fn enforces_actual_decompressed_byte_limits() {
    let entry = json!([]);
    let entry_bytes = entry.to_string().len() as u64;
    let one_file = archive(&[("lists-watchlist.json", entry.clone())]);
    let entry_error = export::import_with_limits(
        one_file.path().to_str().unwrap(),
        entry_bytes - 1,
        entry_bytes * 2,
    )
    .unwrap_err();
    assert!(entry_error.to_string().contains("entry"));

    let two_files = archive(&[
        ("lists-watchlist.json", entry.clone()),
        ("lists-favorites.json", entry),
    ]);
    let total_error = export::import_with_limits(
        two_files.path().to_str().unwrap(),
        entry_bytes,
        entry_bytes * 2 - 1,
    )
    .unwrap_err();
    assert!(total_error.to_string().contains("total"));
}

#[test]
fn ignores_aggregate_watched_files_and_reports_missing_identifiers() {
    let file = archive(&[
        ("watched-movies.json", json!([movie(1, 101)])),
        ("watched-shows-2.json", json!([episode(2, 102, 1, 1)])),
        (
            "lists-watchlist.json",
            json!([{ "movie": { "ids": { "trakt": 3 } } }]),
        ),
    ]);

    let result = export::import(file.path().to_str().unwrap()).unwrap();
    assert!(metadata(&result).is_empty());
    assert_eq!(result.failed.len(), 1);
}
