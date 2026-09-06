use super::*;

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
