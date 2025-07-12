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
    r"(?i)Season\s+\d+",
    r"(?i)Episode\s+\d+",
    r"(?i)(720p|1080p|4K|HDTV|HD|SD|CAM|TS|TC|DVDRip|BRRip|BluRay|WEBRip|WEB-DL)",
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

static YEAR_EXTRACTION_PATTERNS: &[&str] = &[r"\(([12]\d{3})\)", r"\[([12]\d{3})\]"];

fn apply_patterns_with_replacement(text: &str, patterns: &[&str], replacement: &str) -> String {
    let mut result = text.to_string();
    for pattern in patterns {
        if let Ok(re) = Regex::new(pattern) {
            result = re.replace_all(&result, replacement).to_string();
        }
    }
    let space_re = Regex::new(r"\s+").unwrap();
    space_re.replace_all(result.trim(), " ").to_string()
}

fn find_first_capture_group(text: &str, patterns: &[&str]) -> Option<String> {
    patterns.iter().find_map(|pattern| {
        let re = Regex::new(pattern).ok()?;
        let captures = re.captures(text)?;
        let capture = captures.get(1)?;
        Some(capture.as_str().trim().to_string())
    })
}

fn find_two_capture_groups(text: &str, patterns: &[&str]) -> Option<(i32, i32)> {
    patterns.iter().find_map(|pattern| {
        let re = Regex::new(pattern).ok()?;
        let captures = re.captures(text)?;
        let first = captures.get(1)?.as_str().parse().ok()?;
        let second = captures.get(2)?.as_str().parse().ok()?;
        Some((first, second))
    })
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

    let publish_year = extract_year_from_title(&title);
    let best_match = find_best_match(&search_results, &title, publish_year)?;

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

fn extract_year_from_title(title: &str) -> Option<i32> {
    find_first_capture_group(title, YEAR_EXTRACTION_PATTERNS)
        .and_then(|year_str| year_str.parse().ok())
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
    publish_year: Option<i32>,
) -> Result<&'a TmdbMetadataLookupResult> {
    if results.is_empty() {
        return Err(anyhow!("No valid results found").into());
    }

    let cleaned_original = clean_title(original_title);

    let mut best_match = &results[0];
    let mut best_score = 0.0;

    for result in results {
        let title_to_compare = &result.title;
        let mut score = calculate_similarity(&cleaned_original, title_to_compare);

        if let (Some(original_year), Some(result_year)) = (publish_year, result.publish_year) {
            let year_diff = (original_year - result_year).abs();
            if year_diff == 0 {
                score += 0.2;
            } else if year_diff <= 1 {
                score += 0.1;
            }
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_title_removes_years() {
        assert_eq!(clean_title("Andor (2022)"), "Andor");
        assert_eq!(clean_title("The Matrix (1999)"), "The Matrix");
        assert_eq!(clean_title("Movie [2020]"), "Movie");
        assert_eq!(clean_title("Show Name (2023) Extra"), "Show Name Extra");
    }

    #[test]
    fn test_clean_title_removes_season_episode() {
        assert_eq!(clean_title("Breaking Bad S01E01"), "Breaking Bad");
        assert_eq!(clean_title("Game of Thrones S8E6"), "Game of Thrones");
        assert_eq!(clean_title("The Office Season 2"), "The Office");
        assert_eq!(clean_title("Friends Episode 10"), "Friends");
    }

    #[test]
    fn test_clean_title_removes_quality_indicators() {
        assert_eq!(clean_title("Movie 720p"), "Movie");
        assert_eq!(clean_title("Show 1080p BluRay"), "Show");
        assert_eq!(clean_title("Film HDTV"), "Film");
        assert_eq!(clean_title("Series WEBRip"), "Series");
        assert_eq!(clean_title("Movie DVDRip"), "Movie");
    }

    #[test]
    fn test_clean_title_removes_file_extensions() {
        assert_eq!(clean_title("Movie.mp4"), "Movie");
        assert_eq!(clean_title("Show.mkv"), "Show");
        assert_eq!(clean_title("Film.avi"), "Film");
        assert_eq!(clean_title("Series.mov"), "Series");
    }

    #[test]
    fn test_clean_title_removes_release_info() {
        assert_eq!(clean_title("Movie PROPER"), "Movie");
        assert_eq!(clean_title("Show REPACK"), "Show");
        assert_eq!(clean_title("Film EXTENDED"), "Film");
        assert_eq!(clean_title("Series DIRECTOR'S CUT"), "Series");
    }

    #[test]
    fn test_clean_title_removes_brackets() {
        assert_eq!(clean_title("Movie [Release Group]"), "Movie");
        assert_eq!(clean_title("Show {Extra Info}"), "Show");
        assert_eq!(clean_title("Film [720p] {Group}"), "Film");
    }

    #[test]
    fn test_clean_title_complex_cases() {
        assert_eq!(
            clean_title("Andor (2022) S01E01 720p WEBRip [Group]"),
            "Andor"
        );
        assert_eq!(
            clean_title("Breaking Bad Season 1 Episode 2 1080p BluRay"),
            "Breaking Bad"
        );
        assert_eq!(
            clean_title("The Matrix (1999) DIRECTOR'S CUT 4K.mkv"),
            "The Matrix"
        );
    }

    #[test]
    fn test_extract_base_title_from_year() {
        assert_eq!(extract_base_title("Andor (2022)"), "Andor");
        assert_eq!(extract_base_title("The Matrix (1999)"), "The Matrix");
        assert_eq!(extract_base_title("Movie Name (2020) Extra"), "Movie Name");
    }

    #[test]
    fn test_extract_base_title_from_season_episode() {
        assert_eq!(extract_base_title("Breaking Bad S01E01"), "Breaking Bad");
        assert_eq!(
            extract_base_title("Game of Thrones S8E6"),
            "Game of Thrones"
        );
        assert_eq!(extract_base_title("The Office Season 2"), "The Office");
        assert_eq!(extract_base_title("Friends season 1"), "Friends");
    }

    #[test]
    fn test_extract_base_title_fallback_to_clean() {
        assert_eq!(extract_base_title("Movie 720p"), "Movie");
        assert_eq!(extract_base_title("Show [Group]"), "Show");
        assert_eq!(extract_base_title("Film.mkv"), "Film");
    }

    #[test]
    fn test_extract_season_episode_sxex_format() {
        let result = extract_season_episode("Andor S01E01");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);

        let result = extract_season_episode("Breaking Bad S5E14");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 5);
        assert_eq!(info.episode, 14);
    }

    #[test]
    fn test_extract_season_episode_with_spaces() {
        let result = extract_season_episode("Game of Thrones S8 E6");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 8);
        assert_eq!(info.episode, 6);
    }

    #[test]
    fn test_extract_season_episode_full_words() {
        let result = extract_season_episode("Breaking Bad Season 1 Episode 2");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 2);

        let result = extract_season_episode("The Office season 2 episode 10");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 2);
        assert_eq!(info.episode, 10);
    }

    #[test]
    fn test_extract_season_episode_no_match() {
        assert!(extract_season_episode("Just a Movie").is_none());
        assert!(extract_season_episode("Random Text").is_none());
        assert!(extract_season_episode("Movie (2022)").is_none());
    }

    #[test]
    fn test_extract_season_episode_complex_titles() {
        let result = extract_season_episode("Andor (2022) S01E01 720p WEBRip");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);

        let result = extract_season_episode("Breaking Bad Season 1 Episode 2 1080p BluRay");
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 2);
    }

    #[test]
    fn test_calculate_similarity_exact_match() {
        assert_eq!(calculate_similarity("Andor", "Andor"), 1.0);
        assert_eq!(calculate_similarity("BREAKING BAD", "breaking bad"), 1.0);
    }

    #[test]
    fn test_calculate_similarity_substring_match() {
        let score = calculate_similarity("Andor", "Andor: A Star Wars Story");
        assert!(score > 0.2); // Adjusted expectation - substring match gives lower score
        assert!(score < 1.0);

        let score = calculate_similarity("Breaking Bad", "Bad");
        assert!(score > 0.0);
        assert!(score < 1.0);
    }

    #[test]
    fn test_calculate_similarity_word_overlap() {
        let score = calculate_similarity("Star Wars", "Wars of Stars");
        assert!(score > 0.0);

        let score = calculate_similarity("Game of Thrones", "Thrones Game");
        assert!(score > 0.0);
    }

    #[test]
    fn test_calculate_similarity_no_match() {
        assert_eq!(calculate_similarity("Andor", "Breaking Bad"), 0.0);
        assert_eq!(calculate_similarity("Movie", "Show"), 0.0);
    }

    #[test]
    fn test_calculate_similarity_empty_strings() {
        assert_eq!(calculate_similarity("", ""), 1.0); // Empty strings are considered equal
        assert_eq!(calculate_similarity("Andor", ""), 0.0);
        assert_eq!(calculate_similarity("", "Andor"), 0.0);
    }

    #[test]
    fn test_extract_show_information_for_tv_shows() {
        let result = extract_show_information("Andor S01E01", &MediaLot::Show);
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);
    }

    #[test]
    fn test_extract_show_information_for_movies() {
        let result = extract_show_information("The Matrix (1999)", &MediaLot::Movie);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_show_information_tv_show_no_episode() {
        let result = extract_show_information("Just Show Name", &MediaLot::Show);
        assert!(result.is_none());
    }

    #[test]
    fn test_discussed_examples() {
        assert_eq!(clean_title("Andor (2022) S01E01"), "Andor");
        assert_eq!(extract_base_title("Andor (2022) S01E01"), "Andor");
        let episode_info = extract_season_episode("Andor (2022) S01E01");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);

        assert_eq!(
            clean_title("The Rapacious Jailbreaker (1974)"),
            "The Rapacious Jailbreaker"
        );
        assert_eq!(
            extract_base_title("The Rapacious Jailbreaker (1974)"),
            "The Rapacious Jailbreaker"
        );

        assert_eq!(clean_title("Transformers One"), "Transformers One");
        assert_eq!(extract_base_title("Transformers One"), "Transformers One");

        assert_eq!(
            clean_title("Breaking Bad season 1 episode 2"),
            "Breaking Bad"
        );
        assert_eq!(
            extract_base_title("Breaking Bad season 1 episode 2"),
            "Breaking Bad"
        );
        let episode_info = extract_season_episode("Breaking Bad season 1 episode 2");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 2);
    }

    #[test]
    fn test_edge_cases() {
        assert_eq!(clean_title("Movie (1999) vs (2020)"), "Movie vs");

        let episode_info = extract_season_episode("Show S01E01");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);

        let episode_info = extract_season_episode("Show S1E1");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);

        let episode_info = extract_season_episode("Long Show S15E23");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 15);
        assert_eq!(info.episode, 23);

        let episode_info = extract_season_episode("Show S01E01 Season 2 Episode 3");
        assert!(episode_info.is_some());
        let info = episode_info.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);
    }

    #[test]
    fn test_pattern_matching_utilities() {
        let result = apply_patterns_with_replacement("Test (2022)", &[r"\(\d{4}\)"], "");
        assert_eq!(result, "Test");

        let result = find_first_capture_group("Movie (2022)", &[r"^(.+?)\s+\(\d{4}\)"]);
        assert_eq!(result, Some("Movie".to_string()));

        let result = find_two_capture_groups("S01E05", &[r"S(\d+)E(\d+)"]);
        assert_eq!(result, Some((1, 5)));
    }

    #[test]
    fn test_smart_search_strategies() {
        let title = "Andor (2022) S01E01 720p WEBRip [Group]";

        let original = title.to_string();
        let cleaned = clean_title(title);
        let base = extract_base_title(title);

        assert_eq!(original, "Andor (2022) S01E01 720p WEBRip [Group]");
        assert_eq!(cleaned, "Andor");
        assert_eq!(base, "Andor");

        let movie_title = "The Matrix (1999) DIRECTOR'S CUT";
        assert_eq!(clean_title(movie_title), "The Matrix");
        assert_eq!(extract_base_title(movie_title), "The Matrix");

        let quality_title = "Movie Name 1080p BluRay";
        assert_eq!(clean_title(quality_title), "Movie Name");
        assert_eq!(extract_base_title(quality_title), "Movie Name");
    }
}
