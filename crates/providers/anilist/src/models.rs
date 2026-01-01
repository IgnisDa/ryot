use anyhow::{Result, anyhow};
use common_models::{
    EntityAssets, EntityRemoteVideo, EntityRemoteVideoSource, PersonSourceSpecifics,
};
use common_utils::compute_next_page;
use convert_case::{Case, Casing};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    AnimeAiringScheduleSpecifics, AnimeSpecifics, EntityTranslationDetails, MangaSpecifics,
    MetadataDetails, MetadataSearchItem, PartialMetadataPerson, PartialMetadataWithoutId,
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
    pub errors: Option<Vec<nest! { pub message: String }>>,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSearchResponse {
    #[serde(rename = "Page")]
    pub page: Option<
        nest! {
            pub media: Option<Vec<Option<MediaSearchItem>>>,
            pub staff: Option<Vec<Option<StaffSearchItem>>>,
            pub studios: Option<Vec<Option<StudioSearchItem>>>,
            #[serde(rename = "pageInfo")]
            pub page_info: Option<nest! { pub total: Option<u64> }>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaSearchItem {
    pub id: i32,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    pub title: Option<AnilistTitle>,
    #[serde(rename = "bannerImage")]
    pub banner_image: Option<String>,
    #[serde(rename = "coverImage")]
    pub cover_image: Option<
        nest! {
            pub large: Option<String>,
            pub medium: Option<String>,
            #[serde(rename = "extraLarge")]
            pub extra_large: Option<String>,
        },
    >,
    #[serde(rename = "startDate")]
    pub start_date: Option<
        nest! {
            pub day: Option<i32>,
            pub year: Option<i32>,
            pub month: Option<i32>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StaffSearchItem {
    pub id: i32,
    pub name: Option<nest! { pub full: Option<String> }>,
    pub image: Option<
        nest! {
            pub large: Option<String>,
            pub medium: Option<String>,
        },
    >,
    #[serde(rename = "dateOfBirth")]
    pub date_of_birth: Option<
        nest! {
            pub day: Option<i32>,
            pub year: Option<i32>,
            pub month: Option<i32>,
        },
    >,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnilistTitle {
    pub user_preferred: String,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTranslationResponse {
    #[serde(rename = "Media")]
    pub media: Option<MediaTranslation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaTranslation {
    pub description: Option<String>,
    pub title: Option<MediaTranslationTitle>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTranslationTitle {
    pub romaji: Option<String>,
    pub english: Option<String>,
    pub native: Option<String>,
    pub user_preferred: Option<String>,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaDetails {
    pub id: i32,
    pub volumes: Option<i32>,
    pub episodes: Option<i32>,
    pub chapters: Option<i32>,
    #[serde(rename = "isAdult")]
    pub is_adult: Option<bool>,
    pub status: Option<String>,
    #[serde(rename = "type")]
    pub media_type: Option<String>,
    #[serde(rename = "averageScore")]
    pub average_score: Option<i32>,
    pub title: Option<AnilistTitle>,
    pub description: Option<String>,
    pub genres: Option<Vec<Option<String>>>,
    pub tags: Option<Vec<Option<nest! { pub name: String }>>>,
    #[serde(rename = "airingSchedule")]
    pub airing_schedule: Option<
        nest! {
            pub nodes: Option<Vec<Option<nest! {
                pub episode: i32,
                #[serde(rename = "airingAt")]
                pub airing_at: i64,
            }>>>,
        },
    >,
    #[serde(rename = "coverImage")]
    pub cover_image: Option<
        nest! {
            pub large: Option<String>,
            pub medium: Option<String>,
            #[serde(rename = "extraLarge")]
            pub extra_large: Option<String>,
        },
    >,
    #[serde(rename = "startDate")]
    pub start_date: Option<
        nest! {
            pub day: Option<i32>,
            pub year: Option<i32>,
            pub month: Option<i32>,
        },
    >,
    #[serde(rename = "bannerImage")]
    pub banner_image: Option<String>,
    pub staff: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub role: Option<String>,
                pub node: Option<nest! {
                    pub id: i32,
                    pub name: Option<nest! { pub full: Option<String> }>,
                }>,
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
            pub id: Option<String>,
            pub site: Option<String>,
        },
    >,
}

#[nest_struct]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StaffDetails {
    pub id: i32,
    pub name: Option<nest! { pub full: Option<String> }>,
    pub image: Option<
        nest! {
            pub large: Option<String>,
            pub medium: Option<String>,
        },
    >,
    pub gender: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "dateOfBirth")]
    pub date_of_birth: Option<
        nest! {
            pub day: Option<u32>,
            pub year: Option<i32>,
            pub month: Option<u32>,
        },
    >,
    #[serde(rename = "dateOfDeath")]
    pub date_of_death: Option<
        nest! {
            pub day: Option<u32>,
            pub year: Option<i32>,
            pub month: Option<u32>,
        },
    >,
    #[serde(rename = "homeTown")]
    pub home_town: Option<String>,
    #[serde(rename = "characterMedia")]
    pub character_media: Option<
        nest! {
            pub edges: Option<Vec<Option<nest! {
                pub node: Option<MediaSearchItem>,
                pub characters: Option<Vec<Option<nest! {
                    pub name: Option<nest! { pub full: Option<String> }>,
                }>>>,
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
            pub edges: Option<Vec<Option<nest! { pub node: Option<MediaSearchItem> }>>>,
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

pub fn media_status_string(status: Option<String>) -> Option<String> {
    status.map(|f| f.to_case(Case::Title))
}

pub async fn translate_media(
    client: &Client,
    id: &str,
    target_language: &str,
) -> Result<EntityTranslationDetails> {
    let query = r#"
        query MediaTranslationQuery($id: Int!) {
          Media(id: $id) {
            description
            title {
              romaji
              english
              native
              userPreferred
            }
          }
        }
    "#;

    let variables = serde_json::json!({ "id": id.parse::<i64>()? });

    let body = serde_json::json!({
        "query": query,
        "variables": variables
    });

    let response = client
        .post(URL)
        .json(&body)
        .send()
        .await?
        .json::<GraphQLResponse<MediaTranslationResponse>>()
        .await?;

    let media = response
        .data
        .and_then(|d| d.media)
        .ok_or_else(|| anyhow!("No media in translation response"))?;
    let language = target_language.to_lowercase();
    let title = media
        .title
        .as_ref()
        .and_then(|t| match language.as_str() {
            "romaji" => t.romaji.clone(),
            "native" => t.native.clone(),
            "english" => t.english.clone(),
            "user_preferred" => t.user_preferred.clone(),
            _ => None,
        })
        .or_else(|| media.title.as_ref().and_then(|t| t.user_preferred.clone()))
        .or_else(|| media.title.as_ref().and_then(|t| t.english.clone()))
        .or_else(|| media.title.as_ref().and_then(|t| t.romaji.clone()))
        .or_else(|| media.title.as_ref().and_then(|t| t.native.clone()));

    Ok(EntityTranslationDetails {
        title,
        description: media.description,
        ..Default::default()
    })
}

pub async fn media_details(client: &Client, id: &str) -> Result<MetadataDetails> {
    let query = r#"
        query MediaDetailsQuery($id: Int!) {
          Media(id: $id) {
            id
            status
            title { userPreferred }
            airingSchedule { nodes { episode airingAt } }
            isAdult
            episodes
            chapters
            volumes
            description
            coverImage { extraLarge }
            type
            genres
            tags { name }
            startDate { year }
            bannerImage
            staff {
              edges {
                role
                node {
                  id
                  name { full }
                }
              }
            }
            studios { edges { node { id name } } }
            averageScore
            recommendations {
              nodes {
                mediaRecommendation {
                  id
                  type
                  title { userPreferred }
                  coverImage { extraLarge }
                }
              }
            }
            trailer { id site }
          }
        }
    "#;

    let variables = serde_json::json!({ "id": id.parse::<i64>()? });

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
                airing_schedule,
                episodes: media.episodes,
            }),
            None,
        ),
        Some("MANGA") => (
            MediaLot::Manga,
            None,
            Some(MangaSpecifics {
                volumes: media.volumes,
                chapters: media.chapters.map(Decimal::from),
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
            r.unwrap()
                .media_recommendation
                .map(|data| PartialMetadataWithoutId {
                    source: MediaSource::Anilist,
                    identifier: data.id.to_string(),
                    image: data.cover_image.unwrap().extra_large,
                    title: data.title.map(|s| s.user_preferred).unwrap_or_default(),
                    lot: match data.media_type.as_deref() {
                        Some("ANIME") => MediaLot::Anime,
                        Some("MANGA") => MediaLot::Manga,
                        _ => unreachable!(),
                    },
                    ..Default::default()
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
            source,
            url: t.id.unwrap(),
        }
    }));

    let assets = EntityAssets {
        remote_images,
        remote_videos,
        ..Default::default()
    };

    let title = media.title.map(|s| s.user_preferred).unwrap_or_default();
    let identifier = media.id.to_string();
    Ok(MetadataDetails {
        people,
        assets,
        suggestions,
        anime_specifics,
        manga_specifics,
        publish_year: year,
        title: title.clone(),
        provider_rating: score,
        is_nsfw: media.is_adult,
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
    page: u64,
    page_size: u64,
    _is_adult: bool,
) -> Result<(Vec<MetadataSearchItem>, u64, Option<u64>)> {
    let query_str = r#"
        query MediaSearchQuery(
          $page: Int!
          $perPage: Int!
          $search: String!
          $type: MediaType!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total }
            media(search: $search, type: $type) {
              id
              bannerImage
              startDate { year }
              title { userPreferred }
              coverImage { extraLarge }
            }
          }
        }
    "#;

    let variables = serde_json::json!({
        "page": page,
        "search": query,
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
    let next_page = compute_next_page(page, total);
    let media = search
        .media
        .unwrap()
        .into_iter()
        .flatten()
        .map(|b| {
            let title = b.title.map(|s| s.user_preferred).unwrap_or_default();
            MetadataSearchItem {
                title,
                identifier: b.id.to_string(),
                publish_year: b.start_date.and_then(|b| b.year),
                image: b.cover_image.and_then(|l| l.extra_large).or(b.banner_image),
            }
        })
        .collect();
    Ok((media, total, next_page))
}

pub fn build_staff_search_query(search: &str, page: u64, per_page: u64) -> serde_json::Value {
    let query = r#"
        query StaffSearchQuery(
          $search: String!
          $page: Int!
          $perPage: Int!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total }
            staff(search: $search) {
              id
              name { full }
              image { medium }
              dateOfBirth { year }
            }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": {
            "page": page,
            "search": search,
            "perPage": per_page
        }
    })
}

pub fn build_studio_search_query(search: &str, page: u64, per_page: u64) -> serde_json::Value {
    let query = r#"
        query StudioSearchQuery(
          $search: String!
          $page: Int!
          $perPage: Int!
        ) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { total }
            studios(search: $search) { id name }
          }
        }
    "#;

    serde_json::json!({
        "query": query,
        "variables": {
            "page": page,
            "search": search,
            "perPage": per_page
        }
    })
}

pub fn build_staff_details_query(id: i64) -> serde_json::Value {
    let query = r#"
        query StaffQuery($id: Int!) {
          Staff(id: $id) {
            id
            name { full }
            image { large }
            description
            gender
            dateOfBirth {
              day
              year
              month
            }
            dateOfDeath {
              day
              year
              month
            }
            homeTown
            characterMedia {
              edges {
                characters {
                  name { full }
                }
                node {
                  id
                  type
                  title { userPreferred }
                  coverImage { extraLarge }
                }
              }
            }
            staffMedia {
              edges {
                staffRole
                node {
                  id
                  type
                  title { userPreferred }
                  coverImage { extraLarge }
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
                  title { userPreferred }
                  coverImage { extraLarge }
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
