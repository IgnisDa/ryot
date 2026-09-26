use super::*;

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
#[case("Stranger Things: Chapter One: The Vanishing of Will Byers", 1, 1)]
#[case("Stranger Things: Chapter Eight: The Upside Down", 1, 8)]
#[case(
    "Stranger Things: Stranger Things 4: Chapter Nine: The Piggyback",
    4,
    9
)]
#[case("Stranger Things: Stranger Things 4: Chapter Eight: Papa", 4, 8)]
#[case("Stranger Things: Stranger Things 2: Chapter One: MADMAX", 2, 1)]
#[case(
    "Stranger Things: Stranger Things 3: Chapter Eight: The Battle of Starcourt",
    3,
    8
)]
fn test_extract_season_episode_real_netflix_strings(
    #[case] input: &str,
    #[case] expected_season: i32,
    #[case] expected_episode: i32,
) {
    let result = extract_season_episode(input);
    assert!(result.is_some(), "Failed to extract from: {}", input);
    let info = result.unwrap();
    assert_eq!(info.season, expected_season, "Wrong season for: {}", input);
    assert_eq!(
        info.episode, expected_episode,
        "Wrong episode for: {}",
        input
    );
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

#[rstest]
#[case("3%: Season 1: Chapter 01: Cubes", 1, 1)]
#[case("3%: Season 2: Chapter 01: Mirror", 2, 1)]
#[case("Alice in Borderland: Season 1: Episode 1", 1, 1)]
#[case("Life on Our Planet: Season 1: Chapter 1: The Rules of Life", 1, 1)]
#[case("Zero Day: Limited Series: Episode 6", 1, 6)]
#[case("Barbarians: Barbarians II: New Legions (Episode 1)", 2, 1)]
#[case("Beyond Stranger Things: Beyond 2: Mad for Max (Episode 2)", 2, 2)]
#[case("Wanderlust:  1: Wanderlust (Episode 1)", 1, 1)]
fn test_netflix_edge_cases_that_should_extract(
    #[case] input: &str,
    #[case] expected_season: i32,
    #[case] expected_episode: i32,
) {
    let result = extract_season_episode(input);
    assert!(result.is_some(), "Failed to extract from: {}", input);
    let info = result.unwrap();
    assert_eq!(info.season, expected_season, "Wrong season for: {}", input);
    assert_eq!(
        info.episode, expected_episode,
        "Wrong episode for: {}",
        input
    );
}

#[rstest]
#[case("The Gentlemen: Season 1: The Gospel According to Bobby Glass")]
#[case("It's Always Sunny in Philadelphia: Season 15: The Gang Goes to Ireland")]
#[case("Pantheon: Season 2: Olivia & Farhad")]
#[case("3 Body Problem: Season 1: Countdown")]
#[case("ONE PIECE: Season 1: ROMANCE DAWN")]
fn test_netflix_edge_cases_without_episode_numbers(#[case] input: &str) {
    let result = extract_season_episode(input);
    assert!(
        result.is_none(),
        "Should not extract episode info from: {}",
        input
    );
}

#[rstest]
#[case("Money Heist: Part 3: A Quick Vacation")]
#[case("Disenchantment: Part 5: Goodbye Bean")]
#[case("Mulligan: Part 1: Morning in America")]
fn test_netflix_part_as_season(#[case] input: &str) {
    let result = extract_season_episode(input);
    assert!(
        result.is_none(),
        "Should not extract episode from: {}",
        input
    );
}

#[rstest]
#[case(
    "The Echoes of Survivors: Inside Korea's Tragedies: Season 1: Brothers' Home — The Truth About Vanishing Children",
    None
)]
#[case("World War II: From the Frontlines: Season 1: Last Stand", None)]
#[case(
    "Fred and Rose West: A British Horror Story: Limited Series: The Trial",
    None
)]
#[case("Life on Our Planet: Season 1: Chapter 1: The Rules of Life", Some((1, 1)))]
#[case("Big Mouth: Season 8: Lola Skumpy: License to Drive", None)]
#[case(
    "Roman Empire: Julius Caesar: Master of Rome: The Ides of March (Episode 5)",
    Some((1, 5))
)]
fn test_netflix_complex_titles_with_multiple_colons(
    #[case] input: &str,
    #[case] expected: Option<(i32, i32)>,
) {
    let result = extract_season_episode(input);
    let result_tuple = result.as_ref().map(|r| (r.season, r.episode));
    assert_eq!(result_tuple, expected, "Failed for: {}", input);
}

#[rstest]
#[case("1899: Season 1: The Ship", None)]
#[case("3 Body Problem: Season 1: Countdown", None)]
#[case("3%: Season 1: Chapter 01: Cubes", Some((1, 1)))]
#[case("3%: Season 2: Chapter 08: Frogs", Some((2, 8)))]
fn test_netflix_shows_starting_with_numbers(
    #[case] input: &str,
    #[case] expected: Option<(i32, i32)>,
) {
    let result = extract_season_episode(input);
    let result_tuple = result.as_ref().map(|r| (r.season, r.episode));
    assert_eq!(result_tuple, expected, "Failed for: {}", input);
}

#[test]
fn test_netflix_episode_word_format() {
    let result = extract_season_episode("DAHMER: Monster: The Jeffrey Dahmer Story: Episode One");
    assert!(
        result.is_none(),
        "Should not extract 'Episode One' without season context"
    );
}

#[rstest]
#[case(
    "Stranger Things: Stranger Things 3: Chapter Three: The Case of the Missing Lifeguard (Episode 3)",
    "Stranger Things"
)]
#[case("Lupin: Part 2: Chapter 8 (Episode 3)", "Lupin")]
#[case(
    "The Queen's Gambit: Limited Series: Openings (Episode 1)",
    "The Queen's Gambit"
)]
#[case(
    "Behind Her Eyes: Limited Series: Behind Her Eyes (Episode 6)",
    "Behind Her Eyes"
)]
#[case("The Stranger: Limited Series: Episode 1 (Episode 1)", "The Stranger")]
#[case("Unbelievable: Limited Series: Episode 6 (Episode 6)", "Unbelievable")]
#[case(
    "White House Farm: Series 1: Episode 3 (Episode 3)",
    "White House Farm"
)]
#[case(
    "Missing You: Limited Series: Every Breath You Take (Episode 1)",
    "Missing You"
)]
#[case("Criminal: UK: Season 2: Julia (Episode 1)", "Criminal: UK")]
#[case(
    "Age of Samurai: Battle for Japan: Limited Series: Catastrophe (Episode 5)",
    "Age of Samurai: Battle for Japan"
)]
#[case(
    "Hitler and the Nazis: Evil on Trial: Season 1: Crimes Against Humanity (Episode 5)",
    "Hitler and the Nazis: Evil on Trial"
)]
#[case("Barbarians: Barbarians II: Treason (Episode 5)", "Barbarians")]
#[case(
    "The Snow Girl: 1. The Snow Girl: Episode 3 (Episode 3)",
    "The Snow Girl"
)]
fn test_netflix_base_title_extraction(#[case] input: &str, #[case] expected: &str) {
    let result = extract_base_title(input);
    assert_eq!(
        result, expected,
        "Failed to extract base title from: {}",
        input
    );
}

#[rstest]
#[case("White House Farm: Series 1: Episode 6 (Episode 6)", 1, 6)]
#[case("That Mitchell and Webb Look: Series 1: Episode 2 (Episode 2)", 1, 2)]
#[case("Missing You: Limited Series: Chain Reaction (Episode 5)", 1, 5)]
#[case("The Queen's Gambit: Limited Series: End Game (Episode 7)", 1, 7)]
#[case("Behind Her Eyes: Limited Series: Behind Her Eyes (Episode 6)", 1, 6)]
#[case(
    "Crime Scene: The Vanishing at the Cecil Hotel: Limited Series: Lost in Los Angeles (Episode 1)",
    1,
    1
)]
#[case("Cat People: Limited Series: Copycat (Episode 3)", 1, 3)]
#[case(
    "The Lost Pirate Kingdom: Limited Series: Deal or No Deal (Episode 5)",
    1,
    5
)]
#[case("The Snow Girl: 1. The Snow Girl: Episode 3 (Episode 3)", 1, 3)]
fn test_failing_netflix_imports(
    #[case] input: &str,
    #[case] expected_season: i32,
    #[case] expected_episode: i32,
) {
    let result = extract_season_episode(input);
    assert!(result.is_some(), "Failed to extract from: {}", input);
    let info = result.unwrap();
    assert_eq!(info.season, expected_season, "Wrong season for: {}", input);
    assert_eq!(
        info.episode, expected_episode,
        "Wrong episode for: {}",
        input
    );
}

#[rstest]
#[case("Disenchantment: Part 3: Last Splash (Episode 6)", 3, 6)]
#[case("Love, Death & Robots: Volume 3: Mason's Rats (Episode 7)", 3, 7)]
#[case("Making a Murderer: Part 1: The Great Burden (Episode 8)", 1, 8)]
#[case(
    "Knowing Me Knowing You with Alan Partridge: The Complete Series: Episode 1 (Episode 1)",
    1,
    1
)]
#[case(
    "Love, Death & Robots: Volume 4: Smart Appliances, Stupid Owners (Episode 9)",
    4,
    9
)]
fn test_part_volume_complete_series_formats(
    #[case] input: &str,
    #[case] expected_season: i32,
    #[case] expected_episode: i32,
) {
    let result = extract_season_episode(input);
    assert!(result.is_some(), "Failed to extract from: {}", input);
    let info = result.unwrap();
    assert_eq!(info.season, expected_season, "Wrong season for: {}", input);
    assert_eq!(
        info.episode, expected_episode,
        "Wrong episode for: {}",
        input
    );
}

#[rstest]
#[case("13 Reasons Why: Season 4: College Tour (Episode 2)", 4, 2)]
#[case("American Horror Story: Season 1: Pilot (Episode 1)", 1, 1)]
#[case("Stranger Things: Season 3: The Battle of Starcourt (Episode 8)", 3, 8)]
#[case("Breaking Bad: Season 5: Ozymandias (Episode 14)", 5, 14)]
fn test_season_with_colon_and_episode_parens(
    #[case] input: &str,
    #[case] expected_season: i32,
    #[case] expected_episode: i32,
) {
    let result = extract_season_episode(input);
    assert!(result.is_some(), "Failed to extract from: {}", input);
    let info = result.unwrap();
    assert_eq!(info.season, expected_season, "Wrong season for: {}", input);
    assert_eq!(
        info.episode, expected_episode,
        "Wrong episode for: {}",
        input
    );
}
