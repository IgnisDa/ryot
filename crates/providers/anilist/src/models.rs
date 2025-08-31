use anyhow::{Result, anyhow};
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics,
};
use convert_case::{Case, Casing};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    AnimeAiringScheduleSpecifics, AnimeSpecifics, MangaSpecifics, MetadataDetails,
    MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
};
use nest_struct::nest_struct;
use reqwest::Client;
use rust_decimal::Decimal;
use sea_orm::prelude::DateTimeUtc;
use serde::{Deserialize, Serialize};

pub static URL: &str = "https://graphql.anilist.co";
pub static STUDIO_ROLE: &str = "Production Studio";

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphQLResponse<T> {
    pub data: Option<T>,
    pub errors: Option<
        Vec<
            nest! {
                pub message: String,
            },
        >,
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSearchResponse {
    #[serde(rename = "Page")]
    pub page: Option<
        nest! {
            #[serde(rename = "pageInfo")]
            pub page_info: Option<nest! {
                pub total: Option<i32>,
            }>,
            pub media: Option<Vec<Option<MediaSearchItem>>>,
            pub staff: Option<Vec<Option<StaffSearchItem>>>,
            pub studios: Option<Vec<Option<StudioSearchItem>>>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSearchItem {
    pub id: i32,
    pub title: Option<
        nest! {
            pub english: Option<String>,
            pub native: Option<String>,
            pub romaji: Option<String>,
        },
    >,
    #[serde(rename = "coverImage")]
    pub cover_image: Option<
        nest! {
            #[serde(rename = "extraLarge")]
            pub extra_large: Option<String>,
            pub medium: Option<String>,
            pub large: Option<String>,
        },
    >,
    #[serde(rename = "startDate")]
    pub start_date: Option<
        nest! {
            pub year: Option<i32>,
            pub month: Option<i32>,
            pub day: Option<i32>,
        },
    >,
    #[serde(rename = "bannerImage")]
    pub banner_image: Option<String>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaffSearchItem {
    pub id: i32,
    pub name: Option<
        nest! {
            pub full: Option<String>,
        },
    >,
    pub image: Option<
        nest! {
            pub medium: Option<String>,
            pub large: Option<String>,
        },
    >,
    #[serde(rename = "dateOfBirth")]
    pub date_of_birth: Option<
        nest! {
            pub year: Option<i32>,
            pub month: Option<i32>,
            pub day: Option<i32>,
        },
    >,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioSearchItem {
    pub id: i32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetailsResponse {
    #[serde(rename = "Media")]
    pub media: Option<MediaDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaffDetailsResponse {
    #[serde(rename = "Staff")]
    pub staff: Option<StaffDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StudioDetailsResponse {
    #[serde(rename = "Studio")]
    pub studio: Option<StudioDetails>,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetails {
    pub id: i32,
    pub title: Option<
        nest! {
            pub english: Option<String>,
            pub native: Option<String>,
            pub romaji: Option<String>,
        },
    >,
    pub status: Option<String>,
    #[serde(rename = "airingSchedule")]
    pub airing_schedule: Option<
        nest! {
            pub nodes: Option<Vec<Option<nest! {
                #[serde(rename = "airingAt")]
                pub airing_at: i64,
                pub episode: i32,
            }>>>,
        },
    >,
    #[serde(rename = "isAdult")]
    pub is_adult: Option<bool>,
    pub episodes: Option<i32>,
    pub chapters: Option<i32>,
    pub volumes: Option<i32>,
    pub description: Option<String>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub genres: Option<Vec<Option<String>>>,
    #[serde(rename = "coverImage")]
    pub cover_image: Option<
        nest! {
            #[serde(rename = "extraLarge")]
            pub extra_large: Option<String>,
            pub medium: Option<String>,
            pub large: Option<String>,
        },
    >,
    pub tags: Option<
        Vec<
            Option<
                nest! {
                    pub name: String,
                },
            >,
        >,
    >,
    #[serde(rename = "startDate")]
    pub start_date: Option<
        nest! {
            pub year: Option<i32>,
            pub month: Option<i32>,
            pub day: Option<i32>,
        },
    >,
    #[serde(rename = "bannerImage")]
    pub banner_image: Option<String>,
    pub staff: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub node: Option<nest! {
                    pub id: i32,
                    pub name: Option<nest! {
                        pub full: Option<String>,
                    }>,
                }>,
                pub role: Option<String>,
            }>>>,
        },
    >,
    pub studios: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub node: Option<nest! {
                    pub id: i32,
                    pub name: String,
                }>,
            }>>>,
        },
    >,
    #[serde(rename = "averageScore")]
    pub average_score: Option<i32>,
    pub recommendations: Option<
        nest! {
            pub nodes: Option<Vec<Option<nest! {
                #[serde(rename = "mediaRecommendation")]
                pub media_recommendation: Option<MediaSearchItem>,
            }>>>,
        },
    >,
    pub trailer: Option<
        nest! {
            pub site: Option<String>,
            pub id: Option<String>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StaffDetails {
    pub id: i32,
    pub name: Option<
        nest! {
            pub full: Option<String>,
        },
    >,
    pub image: Option<
        nest! {
            pub medium: Option<String>,
            pub large: Option<String>,
        },
    >,
    pub description: Option<String>,
    pub gender: Option<String>,
    #[serde(rename = "dateOfBirth")]
    pub date_of_birth: Option<
        nest! {
            pub year: Option<i32>,
            pub month: Option<i32>,
            pub day: Option<i32>,
        },
    >,
    #[serde(rename = "dateOfDeath")]
    pub date_of_death: Option<
        nest! {
            pub year: Option<i32>,
            pub month: Option<i32>,
            pub day: Option<i32>,
        },
    >,
    #[serde(rename = "homeTown")]
    pub home_town: Option<String>,
    #[serde(rename = "characterMedia")]
    pub character_media: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub characters: Option<Vec<Option<nest! {
                    pub name: Option<nest! {
                        pub full: Option<String>,
                    }>,
                }>>>,
                pub node: Option<MediaSearchItem>,
            }>>>,
        },
    >,
    #[serde(rename = "staffMedia")]
    pub staff_media: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                #[serde(rename = "staffRole")]
                pub staff_role: Option<String>,
                pub node: Option<MediaSearchItem>,
            }>>>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StudioDetails {
    pub id: i32,
    pub name: String,
    #[serde(rename = "siteUrl")]
    pub site_url: Option<String>,
    pub media: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub node: Option<MediaSearchItem>,
            }>>>,
        },
    >,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MediaType {
    #[serde(rename = "ANIME")]
    Anime,
    #[serde(rename = "MANGA")]
    Manga,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MediaStatus {
    #[serde(rename = "FINISHED")]
    Finished,
    #[serde(rename = "RELEASING")]
    Releasing,
    #[serde(rename = "NOT_YET_RELEASED")]
    NotYetReleased,
    #[serde(rename = "CANCELLED")]
    Cancelled,
    #[serde(rename = "HIATUS")]
    Hiatus,
}

pub fn media_status_string(status: Option<String>) -> Option<String> {
    status.map(|f| f.to_case(Case::Title))
}

pub fn get_in_preferred_language(
    native: Option<String>,
    english: Option<String>,
    romaji: Option<String>,
    preferred_language: &config_definition::AnilistPreferredLanguage,
) -> String {
    let title = match preferred_language {
        config_definition::AnilistPreferredLanguage::Native => native.clone(),
        config_definition::AnilistPreferredLanguage::English => english.clone(),
        config_definition::AnilistPreferredLanguage::Romaji => romaji.clone(),
    };
    title.or(native).or(english).or(romaji).unwrap()
}

pub async fn media_details(
    client: &Client,
    id: &str,
    preferred_language: &config_definition::AnilistPreferredLanguage,
) -> Result<MetadataDetails> {
    let query = r#"
        query MediaDetailsQuery($id: Int!) {
          Media(id: $id) {
            id
            title {
              english
              native
              romaji
            }
            status
            airingSchedule {
              nodes {
                airingAt
                episode
              }
            }
            isAdult
            episodes
            chapters
            volumes
            description
            coverImage {
              extraLarge
            }
            type
            genres
            tags {
              name
            }
            startDate {
              year
            }
            bannerImage
            staff {
              edges {
                node {
                  id
                  name {
                    full
                  }
                }
                role
              }
            }
            studios {
              edges {
                node {
                  id
                  name
                }
              }
            }
            averageScore
            recommendations {
              nodes {
                mediaRecommendation {
                  id
                  type
                  title {
                    english
                    native
                    romaji
                  }
                  coverImage {
                    extraLarge
                  }
                }
              }
            }
            trailer {
              site
              id
            }
          }
        }
    "#;

    let variables = serde_json::json!({
        "id": id.parse::<i64>().unwrap()
    });

    let body = serde_json::json!({
        "query": query,
        "variables": variables
    });
    let details = client
        .post(URL)
        .json(&body)
        .send()
        .await?
        .json::<GraphQLResponse<MediaDetailsResponse>>()
        .await?;

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
                            episode: data.episode,
                            airing_at: airing_at.naive_utc(),
                        }
                    })
                })
            })
            .collect_vec()
    });
    let (lot, anime_specifics, manga_specifics) = match media.media_type.as_deref() {
        Some("ANIME") => (
            MediaLot::Anime,
            Some(AnimeSpecifics {
                episodes: media.episodes,
                airing_schedule,
            }),
            None,
        ),
        Some("MANGA") => (
            MediaLot::Manga,
            None,
            Some(MangaSpecifics {
                chapters: media.chapters.map(Decimal::from),
                volumes: media.volumes,
                ..Default::default()
            }),
        ),
        _ => unreachable!(),
    };

    let year = media.start_date.and_then(|b| b.year);

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
                    lot: match data.media_type.as_deref() {
                        Some("ANIME") => MediaLot::Anime,
                        Some("MANGA") => MediaLot::Manga,
                        _ => unreachable!(),
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
        source_url: Some(format!("https://anilist.co/{lot}/{identifier}/{title}")),
        ..Default::default()
    })
}

pub async fn search(
    client: &Client,
    media_type: MediaType,
    query: &str,
    page: Option<i32>,
    page_size: i32,
    _is_adult: bool,
    preferred_language: &config_definition::AnilistPreferredLanguage,
) -> Result<(Vec<MetadataSearchItem>, i32, Option<i32>)> {
    let page = page.unwrap_or(1);

    let query_str = r#"
        query MediaSearchQuery(
          $search: String!
          $page: Int!
          $type: MediaType!
          $perPage: Int!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
            }
            media(search: $search, type: $type) {
              id
              title {
                english
                native
                romaji
              }
              coverImage {
                extraLarge
              }
              startDate {
                year
              }
              bannerImage
            }
          }
        }
    "#;

    let variables = serde_json::json!({
        "search": query,
        "page": page,
        "type": media_type,
        "perPage": page_size
    });

    let body = serde_json::json!({
        "query": query_str,
        "variables": variables
    });

    let search = client
        .post(URL)
        .json(&body)
        .send()
        .await?
        .json::<GraphQLResponse<MediaSearchResponse>>()
        .await?
        .data
        .unwrap()
        .page
        .unwrap();
    let total = search.page_info.unwrap().total.unwrap();
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
                publish_year: b.start_date.and_then(|b| b.year),
            }
        })
        .collect();
    Ok((media, total, next_page))
}

pub fn build_staff_search_query(search: &str, page: i32, per_page: i32) -> serde_json::Value {
    let query = r#"
        query StaffSearchQuery(
          $search: String!
          $page: Int!
          $perPage: Int!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
            }
            staff(search: $search) {
              id
              name {
                full
              }
              image {
                medium
              }
              dateOfBirth {
                year
              }
            }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": {
            "search": search,
            "page": page,
            "perPage": per_page
        }
    })
}

pub fn build_studio_search_query(search: &str, page: i32, per_page: i32) -> serde_json::Value {
    let query = r#"
        query StudioSearchQuery(
          $search: String!
          $page: Int!
          $perPage: Int!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo {
              total
            }
            studios(search: $search) {
              id
              name
            }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": {
            "search": search,
            "page": page,
            "perPage": per_page
        }
    })
}

pub fn build_staff_details_query(id: i64) -> serde_json::Value {
    let query = r#"
        query StaffQuery($id: Int!) {
          Staff(id: $id) {
            id
            name {
              full
            }
            image {
              large
            }
            description
            gender
            dateOfBirth {
              year
              month
              day
            }
            dateOfDeath {
              year
              month
              day
            }
            homeTown
            characterMedia {
              edges {
                characters {
                  name {
                    full
                  }
                }
                node {
                  id
                  type
                  title {
                    native
                    english
                    romaji
                  }
                  coverImage {
                    extraLarge
                  }
                }
              }
            }
            staffMedia {
              edges {
                staffRole
                node {
                  id
                  type
                  title {
                    native
                    english
                    romaji
                  }
                  coverImage {
                    extraLarge
                  }
                }
              }
            }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": {
            "id": id
        }
    })
}

pub fn build_studio_details_query(id: i64) -> serde_json::Value {
    let query = r#"
        query StudioQuery($id: Int!) {
          Studio(id: $id) {
            id
            name
            siteUrl
            media {
              edges {
                node {
                  id
                  type
                  title {
                    english
                    native
                    romaji
                  }
                  coverImage {
                    extraLarge
                  }
                }
              }
            }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": { "id": id }
    })
}
