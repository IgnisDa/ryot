use chrono::NaiveDate;
use musicbrainz_rs::entity::{
    CoverartResponse,
    artist::Artist,
    date_string::DateString,
    release::{Release, ReleaseStatus},
    release_group::ReleaseGroup,
};
use serde::Serialize;

pub fn coverart_url_from_response(response: CoverartResponse) -> Option<String> {
    match response {
        CoverartResponse::Url(url) => Some(url),
        CoverartResponse::Json(coverart) => {
            let image = coverart
                .images
                .iter()
                .find(|image| image.front)
                .or_else(|| coverart.images.first())?;
            image
                .thumbnails
                .res_1200
                .clone()
                .or_else(|| image.thumbnails.res_500.clone())
                .or_else(|| image.thumbnails.res_250.clone())
                .or_else(|| image.thumbnails.large.clone())
                .or_else(|| image.thumbnails.small.clone())
                .or_else(|| Some(image.image.clone()))
        }
    }
}

pub fn extract_publish_date(date: Option<&DateString>) -> (Option<NaiveDate>, Option<i32>) {
    date.map(parse_musicbrainz_date).unwrap_or((None, None))
}

pub fn release_group_description(release_group: &ReleaseGroup) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(value) = release_group.primary_type.as_ref().and_then(enum_to_string) {
        parts.push(value);
    }
    if !release_group.secondary_types.is_empty() {
        let secondary = release_group
            .secondary_types
            .iter()
            .filter_map(enum_to_string)
            .collect::<Vec<_>>()
            .join(", ");
        if !secondary.is_empty() {
            parts.push(secondary);
        }
    }
    if !release_group.disambiguation.is_empty() {
        parts.push(release_group.disambiguation.clone());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" - "))
    }
}

pub fn artist_description(artist: &Artist) -> Option<String> {
    let mut parts = Vec::new();
    if let Some(artist_type) = artist.artist_type.as_ref().and_then(enum_to_string) {
        parts.push(artist_type);
    }
    if let Some(country) = artist
        .country
        .as_ref()
        .filter(|country| !country.is_empty())
    {
        parts.push(format!("Country: {country}"));
    }
    if let Some(area) = artist.area.as_ref().filter(|area| !area.name.is_empty()) {
        parts.push(format!("Area: {}", area.name));
    }
    if let Some(life_span) = artist.life_span.as_ref() {
        let begin = life_span.begin.as_ref().map(|d| d.0.clone());
        let end = life_span.end.as_ref().map(|d| d.0.clone());
        if begin.is_some() || end.is_some() {
            let start = begin.unwrap_or_else(|| "?".to_string());
            let finish = end.unwrap_or_else(|| "?".to_string());
            parts.push(format!("Active: {start} - {finish}"));
        }
    }
    if !artist.disambiguation.is_empty() {
        parts.push(artist.disambiguation.clone());
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" - "))
    }
}

pub fn choose_release(releases: &[Release]) -> Option<&Release> {
    pick_earliest_release(
        releases
            .iter()
            .filter(|release| matches!(release.status, Some(ReleaseStatus::Official))),
    )
    .or_else(|| pick_earliest_release(releases.iter()))
}

fn parse_musicbrainz_date(date: &DateString) -> (Option<NaiveDate>, Option<i32>) {
    let raw = date.0.as_str();
    let year = raw
        .split('-')
        .next()
        .and_then(|part| part.parse::<i32>().ok());

    let full_date = if raw.len() == 10 && !raw.contains('?') {
        date.into_naive_date(1, 1, 1).ok()
    } else {
        None
    };

    (full_date, year)
}

fn enum_to_string<T: Serialize>(value: &T) -> Option<String> {
    serde_json::to_string(value)
        .ok()
        .map(|value| value.trim_matches('"').to_string())
}

fn pick_earliest_release<'a, I>(releases: I) -> Option<&'a Release>
where
    I: IntoIterator<Item = &'a Release>,
{
    let mut selected = None;
    let mut selected_date = None;

    for release in releases {
        let release_date = release_sort_date(release);
        match (selected_date, release_date) {
            (None, None) => {
                if selected.is_none() {
                    selected = Some(release);
                }
            }
            (None, Some(candidate_date)) => {
                selected = Some(release);
                selected_date = Some(candidate_date);
            }
            (Some(current_date), Some(candidate_date)) => {
                if candidate_date < current_date {
                    selected = Some(release);
                    selected_date = Some(candidate_date);
                }
            }
            (Some(_), None) => {}
        }
    }

    selected
}

fn release_sort_date(release: &Release) -> Option<NaiveDate> {
    let (full_date, year) = extract_publish_date(release.date.as_ref());
    full_date.or_else(|| year.and_then(|year| NaiveDate::from_ymd_opt(year, 1, 1)))
}
