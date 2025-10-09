use std::cmp::Ordering;

use anyhow::{Result, bail};
use enum_models::MediaLot;
use media_models::TmdbMetadataLookupResult;

use crate::extractors::{extract_base_title, extract_season_episode};

const EXACT_MATCH_BONUS: f64 = 1.0;
const SUBSTRING_PENALTY: f64 = 0.5;
const EXACT_YEAR_MATCH_BONUS: f64 = 0.2;
const CLOSE_YEAR_MATCH_BONUS: f64 = 0.1;
const SHOW_WITH_EPISODE_BONUS: f64 = 0.5;
const RESULT_POSITION_BONUS_BASE: f64 = 0.05;
const MOVIE_WITHOUT_EPISODE_BONUS: f64 = 0.3;

fn calculate_similarity(a: &str, b: &str) -> f64 {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    if a_lower == b_lower {
        return 1.0;
    }

    if a_lower.contains(&b_lower) || b_lower.contains(&a_lower) {
        let shorter = a_lower.len().min(b_lower.len()) as f64;
        let longer = a_lower.len().max(b_lower.len()) as f64;
        return (shorter / longer) * SUBSTRING_PENALTY;
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

fn calculate_match_score(
    result: &TmdbMetadataLookupResult,
    cleaned_original: &str,
    publish_year: Option<i32>,
    has_episode_indicators: bool,
    result_position: usize,
) -> f64 {
    let mut score = calculate_similarity(cleaned_original, &result.title);

    if cleaned_original.to_lowercase() == result.title.to_lowercase() {
        score += EXACT_MATCH_BONUS;
    }

    if result_position < 5 {
        score += RESULT_POSITION_BONUS_BASE * (5.0 - result_position as f64);
    }

    if let (Some(original_year), Some(result_year)) = (publish_year, result.publish_year) {
        let year_diff = (original_year - result_year).abs();
        if year_diff == 0 {
            score += EXACT_YEAR_MATCH_BONUS;
        } else if year_diff <= 1 {
            score += CLOSE_YEAR_MATCH_BONUS;
        }
    }

    if has_episode_indicators && matches!(result.lot, MediaLot::Show) {
        score += SHOW_WITH_EPISODE_BONUS;
    }

    if !has_episode_indicators && matches!(result.lot, MediaLot::Movie) {
        score += MOVIE_WITHOUT_EPISODE_BONUS;
    }

    score
}

pub fn find_best_match<'a>(
    results: &'a [TmdbMetadataLookupResult],
    original_title: &str,
    publish_year: Option<i32>,
) -> Result<&'a TmdbMetadataLookupResult> {
    if results.is_empty() {
        bail!(
            "No valid search results found for title: '{}'",
            original_title
        );
    }

    let cleaned_original = extract_base_title(original_title);
    let has_episode_indicators = extract_season_episode(original_title).is_some();

    let scores: Vec<(usize, f64)> = results
        .iter()
        .enumerate()
        .map(|(pos, result)| {
            let score = calculate_match_score(
                result,
                &cleaned_original,
                publish_year,
                has_episode_indicators,
                pos,
            );
            (pos, score)
        })
        .collect();

    let best_match_idx = scores
        .iter()
        .max_by(|(_, score_a), (_, score_b)| {
            score_a.partial_cmp(score_b).unwrap_or(Ordering::Equal)
        })
        .map(|(idx, _)| *idx)
        .unwrap();

    Ok(&results[best_match_idx])
}
