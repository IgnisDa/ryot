use super::*;

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
