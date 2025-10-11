use std::{cmp::Ordering, collections::HashSet};

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
const NORMALIZED_EXACT_MATCH_BONUS: f64 = 0.6;
const EXTRA_TOKEN_PENALTY: f64 = 0.1;

fn normalize_for_exact(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

fn tokenize(value: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();

    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch.to_ascii_lowercase());
        } else if !current.is_empty() {
            tokens.insert(current);
            current = String::new();
        }
    }

    if !current.is_empty() {
        tokens.insert(current);
    }

    tokens
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

    let normalized_original = normalize_for_exact(cleaned_original);
    let normalized_result = normalize_for_exact(&result.title);
    if normalized_original == normalized_result {
        score += NORMALIZED_EXACT_MATCH_BONUS;
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

    if EXTRA_TOKEN_PENALTY > 0.0 {
        let original_tokens = tokenize(cleaned_original);
        let result_tokens = tokenize(&result.title);

        if !original_tokens.is_empty() && !result_tokens.is_empty() {
            let extra_tokens = result_tokens.difference(&original_tokens).count();
            if extra_tokens > 0 {
                let penalty = extra_tokens as f64 * EXTRA_TOKEN_PENALTY;
                score = (score - penalty).max(0.0);
            }
        }
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
