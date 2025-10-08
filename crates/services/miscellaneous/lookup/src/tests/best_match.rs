use super::*;

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

    let best_match = find_best_match(&results, "The Last of Us (2023) S02E04", Some(2023)).unwrap();
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

#[test]
fn test_find_best_match_prefers_movies_without_episode_indicators() {
    let results = vec![
        TmdbMetadataLookupResult {
            lot: MediaLot::Show,
            publish_year: Some(2019),
            title: "Shaft".to_string(),
            identifier: "show123".to_string(),
        },
        TmdbMetadataLookupResult {
            lot: MediaLot::Movie,
            publish_year: Some(2019),
            title: "Shaft".to_string(),
            identifier: "movie456".to_string(),
        },
    ];

    let best_match = find_best_match(&results, "Shaft", None).unwrap();
    assert_eq!(best_match.lot, MediaLot::Movie);
    assert_eq!(best_match.identifier, "movie456");
}

#[rstest]
#[case("Good Time")]
#[case("The Sentinel")]
#[case("The Circle")]
#[case("Dangerous")]
fn test_find_best_match_netflix_failing_movies(#[case] title: &str) {
    let results = vec![
        TmdbMetadataLookupResult {
            lot: MediaLot::Show,
            publish_year: Some(2020),
            title: title.to_string(),
            identifier: "show123".to_string(),
        },
        TmdbMetadataLookupResult {
            lot: MediaLot::Movie,
            publish_year: Some(2020),
            title: title.to_string(),
            identifier: "movie456".to_string(),
        },
    ];

    let best_match = find_best_match(&results, title, None).unwrap();
    assert_eq!(
        best_match.lot,
        MediaLot::Movie,
        "Should prefer movie for: {}",
        title
    );
}

#[test]
fn test_find_best_match_movie_bonus_can_be_overcome() {
    let results = vec![
        TmdbMetadataLookupResult {
            lot: MediaLot::Movie,
            publish_year: Some(2020),
            title: "The Stranger".to_string(),
            identifier: "movie123".to_string(),
        },
        TmdbMetadataLookupResult {
            lot: MediaLot::Show,
            publish_year: Some(2020),
            title: "The Stranger".to_string(),
            identifier: "show456".to_string(),
        },
    ];

    let best_match = find_best_match(&results, "The Stranger (2020)", Some(2020)).unwrap();
    assert_eq!(best_match.lot, MediaLot::Movie);
}
