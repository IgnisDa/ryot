mod extractors;
mod matching;
mod patterns;

use std::sync::Arc;

use anyhow::Result;
use common_models::MetadataLookupCacheInput;
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, CachedResponse};
use enum_models::{MediaLot, MediaSource};
use media_models::{
    MetadataLookupFoundResult, MetadataLookupNotFound, MetadataLookupResponse,
    SeenShowExtraInformation, TmdbMetadataLookupResult, UniqueMediaIdentifier,
};
use supporting_service::SupportingService;
use tmdb_provider::TmdbService;

use extractors::{
    clean_title, extract_base_title, extract_season_episode, extract_year_from_title,
};
use matching::find_best_match;

async fn smart_search(
    tmdb_service: &TmdbService,
    title: &str,
) -> Result<Vec<TmdbMetadataLookupResult>> {
    let strategies = [
        title.to_string(),
        clean_title(title),
        extract_base_title(title),
    ];

    for strategy in strategies.into_iter().filter(|s| !s.trim().is_empty()) {
        if let Ok(results) = tmdb_service.multi_search(&strategy).await
            && !results.is_empty()
        {
            return Ok(results);
        }
    }

    Ok(vec![])
}

fn extract_show_information(title: &str, media_lot: &MediaLot) -> Option<SeenShowExtraInformation> {
    if !matches!(media_lot, MediaLot::Show) {
        return None;
    }

    extract_season_episode(title)
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

    use extractors::{clean_title, extract_base_title, extract_season_episode};
    use matching::find_best_match;

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

    #[rstest]
    #[case("Stranger Things: Chapter One: The Vanishing of Will Byers", 1, 1)]
    #[case(
        "Stranger Things: Stranger Things 4: Chapter Nine: The Piggyback",
        4,
        9
    )]
    #[case("Stranger Things: Stranger Things 2: Chapter One: MADMAX", 2, 1)]
    #[case("3%: Season 2: Chapter 01: Mirror", 2, 1)]
    #[case("3%: Season 1: Chapter 08: Button", 1, 8)]
    fn test_extract_season_episode_netflix_chapter_format(
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
    #[case("The OA: Part II: Chapter 8: Overview", 2, 8)]
    #[case("The OA: Part I: Chapter 1: Homecoming", 1, 1)]
    #[case("The OA: Part II: Chapter 7: Nina Azarova", 2, 7)]
    fn test_extract_season_episode_part_chapter_format(
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
    #[case("Dear White People: Volume 4: Chapter VIII", 4, 8)]
    #[case("Dear White People: Volume 3: Chapter VII", 3, 7)]
    fn test_extract_season_episode_volume_format(
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
    #[case("Dept. Q: Season 1: Episode 1", 1, 1)]
    #[case("Dept. Q: Season 1: Episode 9", 1, 9)]
    #[case("Zero Day: Limited Series: Episode 6", 1, 6)]
    #[case("Zero Day: Limited Series: Episode 1", 1, 1)]
    fn test_extract_season_episode_episode_number_format(
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
    #[case("Ancient Apocalypse: The Americas: Chapter VI", 1, 6)]
    #[case("Ancient Apocalypse: The Americas: Chapter I", 1, 1)]
    #[case("Ancient Apocalypse: The Americas: Chapter III", 1, 3)]
    fn test_extract_season_episode_roman_numerals(
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
}
