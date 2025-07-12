use std::sync::Arc;

use anyhow::anyhow;
use async_graphql::Result;
use enum_models::{MediaLot, MediaSource};
use media_models::{
    MetadataLookupResponse, SeenShowExtraInformation, TmdbMetadataLookupResult,
    UniqueMediaIdentifier,
};
use providers::tmdb::TmdbService;
use regex::Regex;
use supporting_service::SupportingService;

static CLEANING_PATTERNS: &[&str] = &[
    r"\([12]\d{3}\)",
    r"\[[12]\d{3}\]",
    r"S\d+E\d+",
    r"Season\s+\d+",
    r"Episode\s+\d+",
    r"(?i)(720p|1080p|4K|HD|SD|CAM|TS|TC|DVDRip|BRRip|BluRay|WEBRip|WEB-DL|HDTV)",
    r"(?i)\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$",
    r"(?i)(PROPER|REPACK|EXTENDED|UNRATED|DIRECTOR.?S.?CUT)",
    r"\[.*?\]",
    r"\{.*?\}",
];

static BASE_EXTRACTION_PATTERNS: &[&str] = &[
    r"^(.+?)\s+\([12]\d{3}\)",
    r"^(.+?)\s+S\d+E\d+",
    r"^(.+?)\s+Season\s+\d+",
    r"^(.+?)\s+season\s+\d+",
];

static SEASON_EPISODE_PATTERNS: &[&str] = &[
    r"S(\d+)E(\d+)",
    r"Season\s+(\d+)\s+Episode\s+(\d+)",
    r"season\s+(\d+)\s+episode\s+(\d+)",
    r"S(\d+)\s+E(\d+)",
];

fn apply_patterns_with_replacement(text: &str, patterns: &[&str], replacement: &str) -> String {
    let mut result = text.to_string();
    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            result = re.replace_all(&result, replacement).to_string();
        }
    }
    result.trim().to_string()
}

fn find_first_capture_group(text: &str, patterns: &[&str]) -> Option<String> {
    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(captures) = re.captures(text) {
                if let Some(capture) = captures.get(1) {
                    return Some(capture.as_str().trim().to_string());
                }
            }
        }
    }
    None
}

fn find_two_capture_groups(text: &str, patterns: &[&str]) -> Option<(i32, i32)> {
    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(captures) = re.captures(text) {
                if let (Some(first_match), Some(second_match)) = (captures.get(1), captures.get(2))
                {
                    if let (Ok(first), Ok(second)) = (
                        first_match.as_str().parse::<i32>(),
                        second_match.as_str().parse::<i32>(),
                    ) {
                        return Some((first, second));
                    }
                }
            }
        }
    }
    None
}

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<MetadataLookupResponse> {
    let tmdb_service = TmdbService::new(ss.clone()).await;

    let search_results = smart_search(&tmdb_service, &title).await?;

    if search_results.is_empty() {
        return Err(anyhow!("No media found for title: {}", title).into());
    }

    let best_match = find_best_match(&search_results, &title)?;

    let data = UniqueMediaIdentifier {
        lot: best_match.lot,
        source: MediaSource::Tmdb,
        identifier: best_match.identifier.clone(),
    };

    let show_information = extract_show_information(&title, &best_match.lot);

    Ok(MetadataLookupResponse {
        data,
        show_information,
    })
}

async fn smart_search(
    tmdb_service: &TmdbService,
    title: &str,
) -> Result<Vec<TmdbMetadataLookupResult>> {
    let search_strategies = vec![
        title.to_string(),
        clean_title(title),
        extract_base_title(title),
    ];

    for strategy in search_strategies {
        if strategy.trim().is_empty() {
            continue;
        }

        if let Ok(results) = tmdb_service.multi_search(&strategy).await {
            if !results.is_empty() {
                return Ok(results);
            }
        }
    }

    Ok(vec![])
}

fn clean_title(title: &str) -> String {
    apply_patterns_with_replacement(title, CLEANING_PATTERNS, "")
}

fn extract_base_title(title: &str) -> String {
    find_first_capture_group(title, BASE_EXTRACTION_PATTERNS).unwrap_or_else(|| clean_title(title))
}

fn calculate_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        let shorter = a_lower.len().min(b_lower.len()) as f64;
        let longer = a_lower.len().max(b_lower.len()) as f64;
        return shorter / longer;
    }

    let common_words: Vec<&str> = a_lower
        .split_whitespace()
        .filter(|word| b_lower.split_whitespace().any(|b_word| b_word == *word))
        .collect();

    let total_words = a_lower
        .split_whitespace()
        .count()
        .max(b_lower.split_whitespace().count());

    if total_words == 0 {
        return 0.0;
    }

    common_words.len() as f64 / total_words as f64
}

fn find_best_match<'a>(
    results: &'a [TmdbMetadataLookupResult],
    original_title: &str,
) -> Result<&'a TmdbMetadataLookupResult> {
    if results.is_empty() {
        return Err(anyhow!("No valid results found").into());
    }

    let cleaned_original = clean_title(original_title);

    let mut best_match = &results[0];
    let mut best_score = 0.0;

    for result in results {
        let title_to_compare = &result.title;
        let score = calculate_similarity(&cleaned_original, title_to_compare);

        if score > best_score {
            best_score = score;
            best_match = result;
        }
    }

    Ok(best_match)
}

fn extract_show_information(title: &str, media_lot: &MediaLot) -> Option<SeenShowExtraInformation> {
    if !matches!(media_lot, MediaLot::Show) {
        return None;
    }

    extract_season_episode(title)
}

fn extract_season_episode(title: &str) -> Option<SeenShowExtraInformation> {
    find_two_capture_groups(title, SEASON_EPISODE_PATTERNS)
        .map(|(season, episode)| SeenShowExtraInformation { season, episode })
}
