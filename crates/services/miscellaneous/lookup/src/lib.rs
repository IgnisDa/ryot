use std::{
    cmp::Ordering,
    collections::HashSet,
    sync::{Arc, OnceLock},
};

use anyhow::{Result, bail};
use common_models::MetadataLookupCacheInput;
use common_utils::get_first_max_index_by;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, CachedResponse};
use enum_models::{MediaLot, MediaSource};
use media_models::{
    MetadataLookupFoundResult, MetadataLookupNotFound, MetadataLookupResponse,
    SeenShowExtraInformation, TmdbMetadataLookupResult, UniqueMediaIdentifier,
};
use regex::Regex;
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;

static COMPILED_SPACE_REGEX: OnceLock<Regex> = OnceLock::new();
static COMPILED_CLEANING_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static COMPILED_SEASON_EPISODE_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static COMPILED_YEAR_EXTRACTION_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
static COMPILED_BASE_EXTRACTION_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

static YEAR_EXTRACTION_PATTERNS: &[&str] = &[r"\(([12]\d{3})\)", r"\[([12]\d{3})\]"];
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
    r"(?i)Season\s+(\d+).*?Episode\s+(\d+)",
];
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

enum PatternSet {
    Cleaning,
    SeasonEpisode,
    YearExtraction,
    BaseExtraction,
}

impl PatternSet {
    fn patterns(&self) -> &[&str] {
        match self {
            PatternSet::Cleaning => CLEANING_PATTERNS,
            PatternSet::SeasonEpisode => SEASON_EPISODE_PATTERNS,
            PatternSet::YearExtraction => YEAR_EXTRACTION_PATTERNS,
            PatternSet::BaseExtraction => BASE_EXTRACTION_PATTERNS,
        }
    }

    fn cache(&self) -> Option<&'static OnceLock<Vec<Regex>>> {
        match self {
            PatternSet::Cleaning => Some(&COMPILED_CLEANING_PATTERNS),
            PatternSet::SeasonEpisode => Some(&COMPILED_SEASON_EPISODE_PATTERNS),
            PatternSet::YearExtraction => Some(&COMPILED_YEAR_EXTRACTION_PATTERNS),
            PatternSet::BaseExtraction => Some(&COMPILED_BASE_EXTRACTION_PATTERNS),
        }
    }
}

fn get_compiled_patterns<'a>(patterns: &[&str], cache: &'a OnceLock<Vec<Regex>>) -> &'a Vec<Regex> {
    cache.get_or_init(|| {
        patterns
            .iter()
            .filter_map(|pattern| Regex::new(pattern).ok())
            .collect()
    })
}

fn get_space_regex() -> &'static Regex {
    COMPILED_SPACE_REGEX.get_or_init(|| Regex::new(r"\s+").unwrap())
}

fn compile_patterns_on_demand(patterns: &[&str]) -> Vec<Regex> {
    patterns
        .iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect()
}

fn apply_patterns_with_replacement(
    text: &str,
    pattern_set: PatternSet,
    replacement: &str,
) -> String {
    let mut result = text.to_string();

    let compiled_patterns = match pattern_set.cache() {
        Some(cache) => get_compiled_patterns(pattern_set.patterns(), cache),
        None => &compile_patterns_on_demand(pattern_set.patterns()),
    };

    for re in compiled_patterns {
        result = re.replace_all(&result, replacement).to_string();
    }

    let space_re = get_space_regex();
    space_re.replace_all(result.trim(), " ").to_string()
}

fn extract_captures<T>(
    text: &str,
    pattern_set: PatternSet,
    extractor: impl Fn(&regex::Captures) -> Option<T>,
) -> Option<T> {
    let compiled_patterns = match pattern_set.cache() {
        Some(cache) => get_compiled_patterns(pattern_set.patterns(), cache),
        None => &compile_patterns_on_demand(pattern_set.patterns()),
    };

    compiled_patterns.iter().find_map(|re| {
        let captures = re.captures(text)?;
        extractor(&captures)
    })
}

fn find_first_capture_group(text: &str, pattern_set: PatternSet) -> Option<String> {
    extract_captures(text, pattern_set, |captures| {
        captures.get(1).map(|cap| cap.as_str().trim().to_string())
    })
}

fn find_two_capture_groups(text: &str, pattern_set: PatternSet) -> Option<(i32, i32)> {
    extract_captures(text, pattern_set, |captures| {
        let first = captures.get(1)?.as_str().parse().ok()?;
        let second = captures.get(2)?.as_str().parse().ok()?;
        Some((first, second))
    })
}

async fn smart_search(
    tmdb_service: &TmdbService,
    title: &str,
) -> Result<Vec<TmdbMetadataLookupResult>> {
    let strategies = HashSet::from([
        title.to_string(),
        clean_title(title),
        extract_base_title(title),
    ]);

    for strategy in strategies {
        if !strategy.trim().is_empty()
            && let Ok(results) = tmdb_service.multi_search(&strategy).await
            && !results.is_empty()
        {
            return Ok(results);
        }
    }

    Ok(vec![])
}

fn clean_title(title: &str) -> String {
    apply_patterns_with_replacement(title, PatternSet::Cleaning, "")
}

fn extract_base_title(title: &str) -> String {
    find_first_capture_group(title, PatternSet::BaseExtraction)
        .unwrap_or_else(|| clean_title(title))
}

fn extract_year_from_title(title: &str) -> Option<i32> {
    find_first_capture_group(title, PatternSet::YearExtraction)
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

fn calculate_match_score(
    result: &TmdbMetadataLookupResult,
    cleaned_original: &str,
    publish_year: Option<i32>,
    has_episode_indicators: bool,
) -> f64 {
    let mut score = calculate_similarity(cleaned_original, &result.title);

    if let (Some(original_year), Some(result_year)) = (publish_year, result.publish_year) {
        let year_diff = (original_year - result_year).abs();
        if year_diff == 0 {
            score += 0.2;
        } else if year_diff <= 1 {
            score += 0.1;
        }
    }

    if has_episode_indicators && matches!(result.lot, MediaLot::Show) {
        score += 0.5;
    }

    score
}

fn find_best_match<'a>(
    results: &'a [TmdbMetadataLookupResult],
    original_title: &str,
    publish_year: Option<i32>,
) -> Result<&'a TmdbMetadataLookupResult> {
    if results.is_empty() {
        bail!("No valid results found");
    }

    let cleaned_original = clean_title(original_title);
    let has_episode_indicators = extract_season_episode(original_title).is_some();

    let best_match_idx = get_first_max_index_by(results, |a, b| {
        let score_a =
            calculate_match_score(a, &cleaned_original, publish_year, has_episode_indicators);
        let score_b =
            calculate_match_score(b, &cleaned_original, publish_year, has_episode_indicators);
        score_a.partial_cmp(&score_b).unwrap_or(Ordering::Equal)
    })
    .unwrap();

    Ok(&results[best_match_idx])
}

fn extract_show_information(title: &str, media_lot: &MediaLot) -> Option<SeenShowExtraInformation> {
    if !matches!(media_lot, MediaLot::Show) {
        return None;
    }

    extract_season_episode(title)
}

fn extract_season_episode(title: &str) -> Option<SeenShowExtraInformation> {
    find_two_capture_groups(title, PatternSet::SeasonEpisode)
        .map(|(season, episode)| SeenShowExtraInformation { season, episode })
}

pub async fn metadata_lookup(
    ss: &Arc<SupportingService>,
    title: String,
) -> Result<CachedResponse<MetadataLookupResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::MetadataLookup(MetadataLookupCacheInput {
            title: title.clone(),
        }),
        ApplicationCacheValue::MetadataLookup,
        || async {
            let tmdb_service = TmdbService::new(ss.clone()).await?;
            let search_results = smart_search(&tmdb_service, &title).await?;

            let response = match search_results.is_empty() {
                true => {
                    MetadataLookupResponse::NotFound(MetadataLookupNotFound { not_found: true })
                }
                false => {
                    let publish_year = extract_year_from_title(&title);
                    let best_match = find_best_match(&search_results, &title, publish_year)?;

                    let data = UniqueMediaIdentifier {
                        lot: best_match.lot,
                        source: MediaSource::Tmdb,
                        identifier: best_match.identifier.clone(),
                    };

                    let show_information = extract_show_information(&title, &best_match.lot);

                    let found_result = MetadataLookupFoundResult {
                        data,
                        show_information,
                    };

                    MetadataLookupResponse::Found(found_result)
                }
            };

            Ok(response)
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    const ANDOR_WITH_YEAR: &str = "Andor (2022)";
    const ANDOR_CLEAN: &str = "Andor";
    const ANDOR_EPISODE: &str = "Andor S01E01";
    const ANDOR_COMPLEX: &str = "Andor (2022) S01E01 720p WEBRip";
    const MATRIX_WITH_YEAR: &str = "The Matrix (1999)";
    const MATRIX_CLEAN: &str = "The Matrix";
    const BREAKING_BAD_EPISODE: &str = "Breaking Bad S01E01";
    const BREAKING_BAD_CLEAN: &str = "Breaking Bad";
    const BREAKING_BAD_SEASON_EPISODE: &str = "Breaking Bad Season 1 Episode 2";
    const BREAKING_BAD_SEASON_EPISODE_COMPLEX: &str =
        "Breaking Bad Season 1 Episode 2 1080p BluRay";
    const HOUSE_EPISODE: &str = "House, M.D.: Season 7: Two Stories (Episode 13)";

    #[rstest]
    #[case(ANDOR_WITH_YEAR, ANDOR_CLEAN)]
    #[case(MATRIX_WITH_YEAR, MATRIX_CLEAN)]
    #[case("Movie [2020]", "Movie")]
    #[case("Show Name (2023) Extra", "Show Name Extra")]
    #[case(BREAKING_BAD_EPISODE, BREAKING_BAD_CLEAN)]
    #[case("Game of Thrones S8E6", "Game of Thrones")]
    #[case("The Office Season 2", "The Office")]
    #[case("Friends Episode 10", "Friends")]
    #[case("Movie 720p", "Movie")]
    #[case("Show 1080p BluRay", "Show")]
    #[case("Film HDTV", "Film")]
    #[case("Series WEBRip", "Series")]
    #[case("Movie DVDRip", "Movie")]
    #[case("Movie.mp4", "Movie")]
    #[case("Show.mkv", "Show")]
    #[case("Film.avi", "Film")]
    #[case("Series.mov", "Series")]
    #[case("Movie PROPER", "Movie")]
    #[case("Show REPACK", "Show")]
    #[case("Film EXTENDED", "Film")]
    #[case("Series DIRECTOR'S CUT", "Series")]
    #[case("Movie [Release Group]", "Movie")]
    #[case("Show {Extra Info}", "Show")]
    #[case("Film [720p] {Group}", "Film")]
    #[case("Andor (2022) S01E01 720p WEBRip [Group]", "Andor")]
    #[case("Breaking Bad Season 1 Episode 2 1080p BluRay", "Breaking Bad")]
    #[case("The Matrix (1999) DIRECTOR'S CUT 4K.mkv", "The Matrix")]
    fn test_clean_title(#[case] input: &str, #[case] expected: &str) {
        assert_eq!(clean_title(input), expected);
    }

    #[rstest]
    #[case(ANDOR_WITH_YEAR, ANDOR_CLEAN)]
    #[case(MATRIX_WITH_YEAR, MATRIX_CLEAN)]
    #[case("Movie Name (2020) Extra", "Movie Name")]
    #[case(BREAKING_BAD_EPISODE, BREAKING_BAD_CLEAN)]
    #[case("Game of Thrones S8E6", "Game of Thrones")]
    #[case("The Office Season 2", "The Office")]
    #[case("Friends season 1", "Friends")]
    #[case("Movie 720p", "Movie")]
    #[case("Show [Group]", "Show")]
    #[case("Film.mkv", "Film")]
    fn test_extract_base_title(#[case] input: &str, #[case] expected: &str) {
        assert_eq!(extract_base_title(input), expected);
    }

    #[rstest]
    #[case(ANDOR_EPISODE, 1, 1)]
    #[case("Breaking Bad S5E14", 5, 14)]
    #[case("Game of Thrones S8 E6", 8, 6)]
    #[case(BREAKING_BAD_SEASON_EPISODE, 1, 2)]
    #[case("The Office season 2 episode 10", 2, 10)]
    #[case(ANDOR_COMPLEX, 1, 1)]
    #[case(BREAKING_BAD_SEASON_EPISODE_COMPLEX, 1, 2)]
    #[case(HOUSE_EPISODE, 7, 13)]
    #[case("HOUSE: SEASON 7: EPISODE 13", 7, 13)]
    #[case("show: season 5: episode 10", 5, 10)]
    fn test_extract_season_episode_valid(
        #[case] input: &str,
        #[case] expected_season: i32,
        #[case] expected_episode: i32,
    ) {
        let result = extract_season_episode(input);
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, expected_season);
        assert_eq!(info.episode, expected_episode);
    }

    #[rstest]
    #[case("Just a Movie")]
    #[case("Random Text")]
    #[case("Movie (2022)")]
    fn test_extract_season_episode_no_match(#[case] input: &str) {
        assert!(extract_season_episode(input).is_none());
    }

    #[rstest]
    #[case(ANDOR_CLEAN, ANDOR_CLEAN, 1.0)]
    #[case("BREAKING BAD", "breaking bad", 1.0)]
    #[case("", "", 1.0)]
    fn test_calculate_similarity_exact_match(
        #[case] a: &str,
        #[case] b: &str,
        #[case] expected: f64,
    ) {
        assert_eq!(calculate_similarity(a, b), expected);
    }

    #[rstest]
    #[case(ANDOR_CLEAN, BREAKING_BAD_CLEAN, 0.0)]
    #[case("Movie", "Show", 0.0)]
    #[case(ANDOR_CLEAN, "", 0.0)]
    #[case("", ANDOR_CLEAN, 0.0)]
    fn test_calculate_similarity_no_match(#[case] a: &str, #[case] b: &str, #[case] expected: f64) {
        assert_eq!(calculate_similarity(a, b), expected);
    }

    #[rstest]
    #[case(ANDOR_CLEAN, "Andor: A Star Wars Story")]
    #[case(BREAKING_BAD_CLEAN, "Bad")]
    #[case("Star Wars", "Wars of Stars")]
    #[case("Game of Thrones", "Thrones Game")]
    fn test_calculate_similarity_partial_match(#[case] a: &str, #[case] b: &str) {
        let score = calculate_similarity(a, b);
        assert!(score > 0.0);
        assert!(score < 1.0);
    }

    #[test]
    fn test_extract_show_information_for_tv_shows() {
        let result = extract_show_information(ANDOR_EPISODE, &MediaLot::Show);
        assert!(result.is_some());
        let info = result.unwrap();
        assert_eq!(info.season, 1);
        assert_eq!(info.episode, 1);
    }

    #[test]
    fn test_extract_show_information_for_movies() {
        let result = extract_show_information(MATRIX_WITH_YEAR, &MediaLot::Movie);
        assert!(result.is_none());
    }

    #[test]
    fn test_extract_show_information_tv_show_no_episode() {
        let result = extract_show_information("Just Show Name", &MediaLot::Show);
        assert!(result.is_none());
    }

    #[test]
    fn test_discussed_examples() {
        assert_eq!(clean_title(ANDOR_COMPLEX), ANDOR_CLEAN);
        assert_eq!(extract_base_title(ANDOR_COMPLEX), ANDOR_CLEAN);
        let episode_info = extract_season_episode(ANDOR_COMPLEX);
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

        assert_eq!(clean_title(BREAKING_BAD_SEASON_EPISODE), BREAKING_BAD_CLEAN);
        assert_eq!(
            extract_base_title(BREAKING_BAD_SEASON_EPISODE),
            BREAKING_BAD_CLEAN
        );
        let episode_info = extract_season_episode(BREAKING_BAD_SEASON_EPISODE);
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

    #[test]
    fn test_find_best_match_prefers_shows_with_episode_indicators() {
        let results = vec![
            TmdbMetadataLookupResult {
                lot: MediaLot::Movie,
                publish_year: Some(2023),
                identifier: "movie123".to_string(),
                title: "The Last of Us".to_string(),
            },
            TmdbMetadataLookupResult {
                lot: MediaLot::Show,
                publish_year: Some(2023),
                identifier: "show456".to_string(),
                title: "The Last of Us".to_string(),
            },
        ];

        let best_match =
            find_best_match(&results, "The Last of Us (2023) S02E04", Some(2023)).unwrap();
        assert_eq!(best_match.lot, MediaLot::Show);
        assert_eq!(best_match.identifier, "show456");
    }

    #[rstest]
    #[case("Breaking Bad S01E01")]
    #[case("Breaking Bad Season 1 Episode 1")]
    #[case("Breaking Bad season 2 episode 5")]
    #[case("Breaking Bad S5 E14")]
    fn test_find_best_match_various_episode_patterns(#[case] pattern: &str) {
        let results = vec![
            TmdbMetadataLookupResult {
                lot: MediaLot::Movie,
                publish_year: Some(2008),
                title: "Breaking Bad".to_string(),
                identifier: "movie123".to_string(),
            },
            TmdbMetadataLookupResult {
                lot: MediaLot::Show,
                publish_year: Some(2008),
                title: "Breaking Bad".to_string(),
                identifier: "show456".to_string(),
            },
        ];

        let best_match = find_best_match(&results, pattern, Some(2008)).unwrap();
        assert_eq!(best_match.lot, MediaLot::Show);
    }

    #[test]
    fn test_find_best_match_no_episode_indicators_unchanged() {
        let results = vec![
            TmdbMetadataLookupResult {
                lot: MediaLot::Movie,
                publish_year: Some(1999),
                title: "The Matrix".to_string(),
                identifier: "movie123".to_string(),
            },
            TmdbMetadataLookupResult {
                lot: MediaLot::Show,
                publish_year: Some(2000),
                identifier: "show456".to_string(),
                title: "The Matrix Show".to_string(),
            },
        ];

        let best_match = find_best_match(&results, "The Matrix (1999)", Some(1999)).unwrap();
        assert_eq!(best_match.lot, MediaLot::Movie);
        assert_eq!(best_match.identifier, "movie123");
    }

    #[test]
    fn test_find_best_match_show_bonus_overcomes_slight_differences() {
        let results = vec![
            TmdbMetadataLookupResult {
                lot: MediaLot::Movie,
                publish_year: Some(2011),
                title: "Game of Thrones".to_string(),
                identifier: "movie123".to_string(),
            },
            TmdbMetadataLookupResult {
                lot: MediaLot::Show,
                publish_year: Some(2011),
                title: "Game of Thrones".to_string(),
                identifier: "show456".to_string(),
            },
        ];

        let best_match =
            find_best_match(&results, "Game of Thrones (2011) S08E06", Some(2011)).unwrap();
        assert_eq!(best_match.lot, MediaLot::Show);
        assert_eq!(best_match.identifier, "show456");
    }
}
