use super::*;
use serde_json::json;

/// Extract the progress of the first seen item, if any.
fn seen_progress(result: &Option<ImportResult>) -> Option<Decimal> {
    result.as_ref()?.completed.first().and_then(|c| match c {
        ImportCompletedItem::Metadata(m) => m.seen_history.first().and_then(|s| s.progress),
        _ => None,
    })
}

/// Extract the identifier and season or episode numbers of the first item.
fn first_details(result: &Option<ImportResult>) -> Option<(String, Option<i32>, Option<i32>)> {
    result.as_ref()?.completed.first().and_then(|c| match c {
        ImportCompletedItem::Metadata(m) => {
            let seen = m.seen_history.first()?;
            Some((
                m.identifier.clone(),
                seen.show_season_number,
                seen.show_episode_number,
            ))
        }
        _ => None,
    })
}

fn run_official(
    payload: Value,
    user: Option<&str>,
    provider: Option<&str>,
) -> Result<Option<ImportResult>> {
    let info = parse_official_payload(&payload)?;
    resolve(info, user, provider)
}

#[test]
fn official_movie_stop_completed_is_full_progress() {
    let payload = json!({
        "NotificationType": "PlaybackStop",
        "ItemType": "Movie",
        "Provider_tmdb": "789",
        "PlayedToCompletion": true
    });
    let result = run_official(payload, None, None).unwrap();
    assert_eq!(seen_progress(&result), Some(dec!(100)));
}

#[test]
fn official_episode_start_with_numbers_computes_progress() {
    let payload = json!({
        "NotificationType": "PlaybackStart",
        "ItemType": "Episode",
        "Provider_tmdb": "999",
        "SeriesProvider_tmdb": "101",
        "Series": {"ProviderIds": {"Tmdb": "101"}},
        "SeasonNumber": 1,
        "EpisodeNumber": 2,
        "PlaybackPositionTicks": 500,
        "RunTimeTicks": 2000,
        "PlayedToCompletion": false
    });
    let result = run_official(payload, None, None).unwrap();
    assert_eq!(seen_progress(&result), Some(dec!(25)));
    assert_eq!(
        first_details(&result).unwrap(),
        ("101".to_owned(), Some(1), Some(2))
    );
}

#[test]
fn official_string_coerced_values_parse() {
    let payload = json!({
        "NotificationType": "PlaybackProgress",
        "ItemType": "Episode",
        "Provider_TMDB": "999",
        "SeriesProvider_TMDB": "202",
        "SeasonNumber00": "01",
        "EpisodeNumber00": "02",
        "PlaybackPositionTicks": "500",
        "RunTimeTicks": "2000",
        "PlayedToCompletion": "False"
    });
    let result = run_official(payload, None, None).unwrap();
    assert_eq!(seen_progress(&result), Some(dec!(25)));
    assert_eq!(
        first_details(&result).unwrap(),
        ("202".to_owned(), Some(1), Some(2))
    );
    let completed = json!({
        "NotificationType": "PlaybackStop",
        "ItemType": "Movie",
        "Provider_tmdb": "202",
        "PlayedToCompletion": "True"
    });
    let result = run_official(completed, None, None).unwrap();
    assert_eq!(seen_progress(&result), Some(dec!(100)));
}

/// A playback payload as sent by the official plugin for an episode, which only carries
/// the provider ids of the episode itself and not those of its series.
fn plugin_episode_payload() -> Value {
    json!({
        "NotificationType": "PlaybackProgress",
        "ItemType": "Episode",
        "Name": "Messages from Earth",
        "SeriesName": "Babylon 5",
        "SeriesId": "4cf4b1e2b5a14b4f9a3b0d6f3f6c1d2e",
        "SeasonNumber": 3,
        "EpisodeNumber": 11,
        "Provider_tvdb": "19541",
        "Provider_imdb": "tt0517686",
        "Provider_tmdb": "68923",
        "PlaybackPositionTicks": 500,
        "RunTimeTicks": 2000,
        "PlayedToCompletion": false
    })
}

#[test]
fn official_episode_ids_are_not_used_as_show_ids() {
    for provider in [Some("tvdb"), None] {
        let error = run_official(plugin_episode_payload(), None, provider).unwrap_err();
        assert!(
            error.to_string().starts_with("No T"),
            "expected no show id for {provider:?}, got {error}"
        );
    }
}

#[test]
fn official_episode_show_is_looked_up_by_episode_id() {
    let info = parse_official_payload(&plugin_episode_payload()).unwrap();
    assert_eq!(info.series_name.as_deref(), Some("Babylon 5"));
    assert_eq!(info.episode_imdb_id.as_deref(), Some("tt0517686"));
    assert_eq!(
        episode_show_lookup(&info, Some("tvdb")),
        Some(EpisodeShowLookup::TvdbEpisode("19541".to_owned()))
    );
    assert_eq!(
        episode_show_lookup(&info, None),
        Some(EpisodeShowLookup::TmdbEpisode("68923".to_owned()))
    );
    let mut info = info;
    info.tvdb_id = Some("70726".to_owned());
    assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
    let result = resolve(info, None, Some("tvdb")).unwrap();
    assert_eq!(
        first_details(&result).unwrap(),
        ("70726".to_owned(), Some(3), Some(11))
    );
}

#[test]
fn official_episode_without_tmdb_id_is_looked_up_by_external_ids() {
    let mut payload = plugin_episode_payload();
    payload.as_object_mut().unwrap().remove("Provider_tmdb");
    let info = parse_official_payload(&payload).unwrap();
    assert!(episode_show_lookup(&info, None).is_some());
    assert_eq!(
        episode_show_lookup(&info, None),
        Some(EpisodeShowLookup::TmdbExternalIds)
    );
    // TVDB lookups still need the TVDB id of the episode.
    payload.as_object_mut().unwrap().remove("Provider_tvdb");
    let info = parse_official_payload(&payload).unwrap();
    assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
    payload.as_object_mut().unwrap().remove("Provider_imdb");
    let info = parse_official_payload(&payload).unwrap();
    assert!(episode_show_lookup(&info, None).is_none());
}

#[test]
fn official_external_ids_lookups_are_cached_by_provider() {
    let mut payload = plugin_episode_payload();
    payload.as_object_mut().unwrap().remove("Provider_tmdb");
    let info = parse_official_payload(&payload).unwrap();
    assert_eq!(
        episode_external_ids_cache_input(&info),
        EpisodeExternalIdsCacheInput {
            imdb_id: Some("tt0517686".to_owned()),
            tvdb_id: Some("19541".to_owned()),
        }
    );
    // The same id from another provider is a different episode.
    let with_only = |provider: &str| {
        let mut payload = plugin_episode_payload();
        let ids = payload.as_object_mut().unwrap();
        for key in ["Provider_tmdb", "Provider_imdb", "Provider_tvdb"] {
            ids.remove(key);
        }
        ids.insert(provider.to_owned(), json!("19541"));
        parse_official_payload(&payload).unwrap()
    };
    let imdb_only = with_only("Provider_imdb");
    let tvdb_only = with_only("Provider_tvdb");
    assert_ne!(
        episode_external_ids_cache_input(&imdb_only),
        episode_external_ids_cache_input(&tvdb_only)
    );
}

#[test]
fn official_show_ids_and_movies_need_no_lookup() {
    let mut payload = plugin_episode_payload();
    payload["SeriesProvider_tvdb"] = json!("70726");
    let info = parse_official_payload(&payload).unwrap();
    assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
    let movie = json!({
        "NotificationType": "PlaybackStop",
        "ItemType": "Movie",
        "Provider_tmdb": "789",
        "PlayedToCompletion": true
    });
    let info = parse_official_payload(&movie).unwrap();
    assert_eq!(info.tmdb_id.as_deref(), Some("789"));
    assert_eq!(episode_show_lookup(&info, None), None);
}

#[test]
fn official_completed_without_ticks_is_full_progress() {
    let payload = json!({
        "NotificationType": "PlaybackStop",
        "ItemType": "Movie",
        "Provider_tmdb": "303",
        "PlayedToCompletion": true
    });
    let result = run_official(payload, None, None).unwrap();
    assert_eq!(seen_progress(&result), Some(dec!(100)));
}

#[test]
fn unsupported_notification_types_are_ignored() {
    for notification in ["ItemAdded", "SessionStart", "AuthenticationSuccess"] {
        let payload = json!({
            "NotificationType": notification,
            "ItemType": "Movie",
            "Provider_tmdb": "404",
            "PlaybackPositionTicks": 10,
            "RunTimeTicks": 100
        });
        let result = run_official(payload, None, None).unwrap();
        assert!(result.is_none(), "expected {notification} to be ignored");
    }
}

#[test]
fn nested_episode_never_uses_item_id_as_series_id() {
    for event in ["Play", "Progress", "Stop", "MarkPlayed"] {
        let info = parse_official_payload(&json!({
            "Event": event,
            "Item": {
                "Type": "Episode", "SeriesName": "Peacemaker",
                "ParentIndexNumber": 1, "IndexNumber": 2,
                "ProviderIds": {"Tmdb": "2438351", "Tvdb": "episode-tvdb"}
            },
            "Series": {"ProviderIds": {"Tmdb": "110492", "Tvdb": "series-tvdb"}}
        }))
        .unwrap();
        assert_eq!(info.tmdb_id.as_deref(), Some("110492"));
        assert_eq!(info.episode_tmdb_id.as_deref(), Some("2438351"));
        assert_eq!(info.tvdb_id.as_deref(), Some("series-tvdb"));
        assert_eq!(episode_show_lookup(&info, None), None);
        assert_eq!(episode_show_lookup(&info, Some("tvdb")), None);
    }
}

#[test]
fn nested_episode_without_series_id_requires_lookup() {
    let info = parse_official_payload(&json!({
        "Event": "Progress",
        "Item": {"Type": "Episode", "ProviderIds": {"Tmdb": "2438351", "Tvdb": "123"}},
        "Series": {"Name": "Peacemaker"}
    }))
    .unwrap();
    assert_eq!(info.series_name.as_deref(), Some("Peacemaker"));
    assert_eq!(info.tmdb_id, None);
    assert_eq!(info.tvdb_id, None);
    assert_eq!(
        episode_show_lookup(&info, None),
        Some(EpisodeShowLookup::TmdbEpisode("2438351".into()))
    );
    assert_eq!(
        episode_show_lookup(&info, Some("tvdb")),
        Some(EpisodeShowLookup::TvdbEpisode("123".into()))
    );
    assert!(resolve(info, None, None).is_err());
}

#[test]
fn nested_movie_ticks_completion_and_user_filter_are_preserved() {
    let mut payload = json!({
        "Event": "Progress",
        "User": {"Name": "alice"},
        "Item": {"Type": "Movie", "Name": "Movie title, not username", "RunTimeTicks": 1000, "ProviderIds": {"Tmdb": "123"}},
        "Session": {"PlayState": {"PositionTicks": 250}}
    });
    let info = parse_official_payload(&payload).unwrap();
    assert!(resolve(info.clone(), Some("bob"), None).unwrap().is_none());
    let result = resolve(info, Some("alice"), None).unwrap().unwrap();
    let ImportCompletedItem::Metadata(item) = &result.completed[0] else {
        panic!("expected metadata");
    };
    assert_eq!(item.identifier, "123");
    assert_eq!(item.seen_history[0].progress, Some(dec!(25)));
    payload["Event"] = json!("MarkPlayed");
    payload["Item"]
        .as_object_mut()
        .unwrap()
        .remove("RunTimeTicks");
    let result = resolve(parse_official_payload(&payload).unwrap(), None, None)
        .unwrap()
        .unwrap();
    let ImportCompletedItem::Metadata(item) = &result.completed[0] else {
        panic!("expected metadata");
    };
    assert_eq!(item.seen_history[0].progress, Some(dec!(100)));
    payload["Event"] = json!("MarkUnplayed");
    assert!(
        resolve(parse_official_payload(&payload).unwrap(), None, None)
            .unwrap()
            .is_none()
    );
}
