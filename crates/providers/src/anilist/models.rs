use anyhow::{Result, anyhow};
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics,
};
use config::AnilistPreferredLanguage;
use enum_models::{MediaLot, MediaSource};
use graphql_client::{GraphQLQuery, Response};
use itertools::Itertools;
use media_models::{
    AnimeAiringScheduleSpecifics, AnimeSpecifics, MangaSpecifics, MetadataDetails,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
};
use reqwest::Client;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;

pub static URL: &str = "https://graphql.anilist.co";
pub static STUDIO_ROLE: &str = "Production Studio";

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/media_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct MediaSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/staff_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct StaffSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/studio_search.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct StudioSearchQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/media_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct MediaDetailsQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/staff_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct StaffQuery;

#[derive(GraphQLQuery)]
#[graphql(
    schema_path = "src/anilist/schema.json",
    query_path = "src/anilist/studio_details.graphql",
    response_derives = "Debug,Clone",
    variables_derives = "Debug"
)]
pub struct StudioQuery;

pub fn media_status_string(status: Option<media_details_query::MediaStatus>) -> Option<String> {
    match status {
        Some(media_details_query::MediaStatus::FINISHED) => Some("Finished".to_string()),
        Some(media_details_query::MediaStatus::RELEASING) => Some("Ongoing".to_string()),
        Some(media_details_query::MediaStatus::NOT_YET_RELEASED) => {
            Some("Not Yet Released".to_string())
        }
        Some(media_details_query::MediaStatus::CANCELLED) => Some("Canceled".to_string()),
        Some(media_details_query::MediaStatus::HIATUS) => Some("Hiatus".to_string()),
        _ => None,
    }
}

pub fn get_in_preferred_language(
    native: Option<String>,
    english: Option<String>,
    romaji: Option<String>,
    preferred_language: &AnilistPreferredLanguage,
) -> String {
    let title = match preferred_language {
        AnilistPreferredLanguage::Native => native.clone(),
        AnilistPreferredLanguage::English => english.clone(),
        AnilistPreferredLanguage::Romaji => romaji.clone(),
    };
    title.or(native).or(english).or(romaji).unwrap()
}

pub async fn media_details(
    client: &Client,
    id: &str,
    preferred_language: &AnilistPreferredLanguage,
) -> Result<MetadataDetails> {
    let variables = media_details_query::Variables {
        id: id.parse::<i64>().unwrap(),
    };
    let body = MediaDetailsQuery::build_query(variables);
    let details = client
        .post(URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<Response<media_details_query::ResponseData>>()
        .await
        .map_err(|e| anyhow!(e))?;

    let data = details.data.ok_or_else(|| anyhow!("No data in response"))?;
    let media = data.media.ok_or_else(|| anyhow!("No media in data"))?;

    let mut images = Vec::from_iter(media.cover_image.and_then(|i| i.extra_large));
    if let Some(i) = media.banner_image {
        images.push(i);
    }
    let remote_images = images.into_iter().unique().collect();
    let mut genres = media
        .genres
        .into_iter()
        .flatten()
        .map(|t| t.unwrap())
        .collect_vec();
    genres.extend(
        media
            .tags
            .unwrap_or_default()
            .into_iter()
            .flatten()
            .map(|t| t.name),
    );
    let mut people = Vec::from_iter(media.staff)
        .into_iter()
        .flat_map(|s| s.edges.unwrap())
        .flatten()
        .map(|s| {
            let node = s.node.unwrap();
            PartialMetadataPerson {
                role: s.role.unwrap(),
                source: MediaSource::Anilist,
                identifier: node.id.to_string(),
                name: node.name.unwrap().full.unwrap(),
                ..Default::default()
            }
        })
        .collect_vec();
    people.extend(
        Vec::from_iter(media.studios)
            .into_iter()
            .flat_map(|s| s.edges.unwrap())
            .flatten()
            .map(|s| {
                let node = s.node.unwrap();
                PartialMetadataPerson {
                    name: node.name,
                    source: MediaSource::Anilist,
                    role: STUDIO_ROLE.to_owned(),
                    identifier: node.id.to_string(),
                    source_specifics: Some(PersonSourceSpecifics {
                        is_anilist_studio: Some(true),
                        ..Default::default()
                    }),
                    ..Default::default()
                }
            }),
    );
    let people = people.into_iter().unique().collect_vec();
    let airing_schedule = media.airing_schedule.and_then(|a| a.nodes).map(|a| {
        a.into_iter()
            .flat_map(|s| {
                s.and_then(|data| {
                    DateTimeUtc::from_timestamp(data.airing_at, 0).map(|airing_at| {
                        AnimeAiringScheduleSpecifics {
                            episode: data.episode.try_into().unwrap(),
                            airing_at: airing_at.naive_utc(),
                        }
                    })
                })
            })
            .collect_vec()
    });
    let (lot, anime_specifics, manga_specifics) = match media.type_.unwrap() {
        media_details_query::MediaType::ANIME => (
            MediaLot::Anime,
            Some(AnimeSpecifics {
                episodes: media.episodes.and_then(|c| c.try_into().ok()),
                airing_schedule,
            }),
            None,
        ),
        media_details_query::MediaType::MANGA => (
            MediaLot::Manga,
            None,
            Some(MangaSpecifics {
                chapters: media.chapters.map(Decimal::from),
                volumes: media.volumes.and_then(|v| v.try_into().ok()),
                ..Default::default()
            }),
        ),
        media_details_query::MediaType::Other(_) => unreachable!(),
    };

    let year = media
        .start_date
        .and_then(|b| b.year.map(|y| y.try_into().unwrap()));

    let suggestions = media
        .recommendations
        .unwrap()
        .nodes
        .unwrap()
        .into_iter()
        .flat_map(|r| {
            r.unwrap().media_recommendation.map(|data| {
                let title = data.title.unwrap();
                let title = get_in_preferred_language(
                    title.native,
                    title.english,
                    title.romaji,
                    preferred_language,
                );
                PartialMetadataWithoutId {
                    title,
                    source: MediaSource::Anilist,
                    identifier: data.id.to_string(),
                    image: data.cover_image.unwrap().extra_large,
                    lot: match data.type_.unwrap() {
                        media_details_query::MediaType::ANIME => MediaLot::Anime,
                        media_details_query::MediaType::MANGA => MediaLot::Manga,
                        media_details_query::MediaType::Other(_) => unreachable!(),
                    },
                    ..Default::default()
                }
            })
        })
        .collect();
    let score = media.average_score.map(Decimal::from);
    let remote_videos = Vec::from_iter(media.trailer.map(|t| {
        let source = match t.site.unwrap().as_str() {
            "youtube" => EntityRemoteVideoSource::Youtube,
            "dailymotion" => EntityRemoteVideoSource::Dailymotion,
            _ => unreachable!(),
        };
        EntityRemoteVideo {
            url: t.id.unwrap(),
            source,
        }
    }));

    let assets = EntityAssets {
        remote_images,
        remote_videos,
        ..Default::default()
    };

    let title = media.title.unwrap();
    let title = get_in_preferred_language(
        title.native,
        title.english,
        title.romaji,
        preferred_language,
    );
    let identifier = media.id.to_string();
    Ok(MetadataDetails {
        lot,
        people,
        assets,
        suggestions,
        anime_specifics,
        manga_specifics,
        publish_year: year,
        title: title.clone(),
        provider_rating: score,
        is_nsfw: media.is_adult,
        source: MediaSource::Anilist,
        identifier: identifier.clone(),
        description: media.description,
        genres: genres.into_iter().unique().collect(),
        production_status: media_status_string(media.status),
        source_url: Some(format!(
            "https://anilist.co/{}/{}/{}",
            lot, identifier, title
        )),
        ..Default::default()
    })
}

pub async fn search(
    client: &Client,
    media_type: media_search_query::MediaType,
    query: &str,
    page: Option<i32>,
    page_size: i32,
    _is_adult: bool,
    preferred_language: &AnilistPreferredLanguage,
) -> Result<(Vec<MetadataSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);
    let variables = media_search_query::Variables {
        page: page.into(),
        search: query.to_owned(),
        type_: media_type,
        per_page: page_size.into(),
    };
    let body = MediaSearchQuery::build_query(variables);
    let search = client
        .post(URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow!(e))?
        .json::<Response<media_search_query::ResponseData>>()
        .await
        .map_err(|e| anyhow!(e))?
        .data
        .unwrap()
        .page
        .unwrap();
    let total = search.page_info.unwrap().total.unwrap().try_into().unwrap();
    let next_page = (total - (page * page_size) > 0).then(|| page + 1);
    let media = search
        .media
        .unwrap()
        .into_iter()
        .flatten()
        .map(|b| {
            let title = b.title.unwrap();
            let title = get_in_preferred_language(
                title.native,
                title.english,
                title.romaji,
                preferred_language,
            );
            MetadataSearchItem {
                identifier: b.id.to_string(),
                title,
                image: b.cover_image.and_then(|l| l.extra_large).or(b.banner_image),
                publish_year: b
                    .start_date
                    .and_then(|b| b.year.map(|y| y.try_into().unwrap())),
            }
        })
        .collect();
    Ok((media, total, next_page))
}
