use anyhow::Result;
use async_trait::async_trait;
use common_models::{PersonSourceSpecifics, SearchDetails, StoredUrl};
use common_utils::TEMP_DIR;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{MetadataGroupSearchResponse, PeopleSearchResponse, SearchResults};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    CommitMediaInput, MetadataDetails, MetadataGroupSearchItem, MetadataImage,
    MetadataImageForMediaDetails, MetadataPerson, MetadataPersonRelated, MetadataSearchItem,
    MusicSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use rustypipe::{
    client::{RustyPipe, RustyPipeQuery},
    model::{richtext::ToHtml, Thumbnail},
};
use traits::MediaProvider;

pub struct YoutubeMusicService {
    client: RustyPipeQuery,
}

impl YoutubeMusicService {
    pub async fn new() -> Self {
        let client = RustyPipe::builder().storage_dir(TEMP_DIR).build().unwrap();
        Self {
            client: client.query(),
        }
    }
}

impl YoutubeMusicService {
    fn order_images_by_size(&self, images: &[Thumbnail]) -> Vec<Thumbnail> {
        images
            .iter()
            .cloned()
            .sorted_by_key(|i| i.width * i.height)
            .rev()
            .collect()
    }

    fn largest_image(&self, images: &[Thumbnail]) -> Option<Thumbnail> {
        self.order_images_by_size(images).first().cloned()
    }
}

#[async_trait]
impl MediaProvider for YoutubeMusicService {
    async fn metadata_details(&self, identifier: &str) -> Result<MetadataDetails> {
        let details = self.client.music_details(identifier).await?;
        let suggestions = if let Some(related_id) = details.related_id {
            let related = self.client.music_related(related_id).await?;
            related
                .tracks
                .into_iter()
                .map(|t| PartialMetadataWithoutId {
                    title: t.name,
                    identifier: t.id,
                    lot: MediaLot::Music,
                    is_recommendation: None,
                    source: MediaSource::YoutubeMusic,
                    image: self.largest_image(&t.cover).map(|c| c.url.to_owned()),
                })
                .collect()
        } else {
            vec![]
        };
        let identifier = details.track.id;
        Ok(MetadataDetails {
            suggestions,
            lot: MediaLot::Music,
            title: details.track.name,
            identifier: identifier.clone(),
            source: MediaSource::YoutubeMusic,
            groups: details
                .track
                .album
                .into_iter()
                .map(|a| CommitMediaInput {
                    name: a.name,
                    unique: UniqueMediaIdentifier {
                        identifier: a.id,
                        lot: MediaLot::Music,
                        source: MediaSource::YoutubeMusic,
                    },
                })
                .collect(),
            source_url: Some(format!("https://music.youtube.com/watch?v={}", identifier)),
            music_specifics: Some(MusicSpecifics {
                by_various_artists: Some(details.track.by_va),
                duration: details.track.duration.map(|d| d.try_into().unwrap()),
                view_count: details.track.view_count.map(|v| v.try_into().unwrap()),
            }),
            url_images: self
                .order_images_by_size(&details.track.cover)
                .into_iter()
                .map(|t| MetadataImageForMediaDetails { image: t.url })
                .collect(),
            people: details
                .track
                .artists
                .into_iter()
                .filter_map(|a| {
                    a.id.map(|id| PartialMetadataPerson {
                        name: a.name,
                        identifier: id,
                        character: None,
                        source_specifics: None,
                        role: "Artist".to_string(),
                        source: MediaSource::YoutubeMusic,
                    })
                })
                .collect(),
            ..Default::default()
        })
    }

    async fn metadata_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let results = self.client.music_search_tracks(query).await?;
        let data = SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: results
                .items
                .items
                .into_iter()
                .map(|i| MetadataSearchItem {
                    title: i.name,
                    identifier: i.id,
                    publish_year: None,
                    image: self.largest_image(&i.cover).map(|t| t.url.to_owned()),
                })
                .collect(),
        };
        Ok(data)
    }

    async fn metadata_group_details(
        &self,
        identifier: &str,
    ) -> Result<(MetadataGroupWithoutId, Vec<PartialMetadataWithoutId>)> {
        let album = self.client.music_album(identifier).await?;
        let title = album.name;
        Ok((
            MetadataGroupWithoutId {
                title: title.clone(),
                lot: MediaLot::Music,
                identifier: album.id,
                display_images: vec![],
                source: MediaSource::YoutubeMusic,
                parts: album.tracks.len().try_into().unwrap(),
                description: album.description.map(|d| d.to_html()),
                source_url: album
                    .playlist_id
                    .map(|id| format!("https://music.youtube.com/playlist?list={}", id)),
                images: Some(
                    self.largest_image(&album.cover)
                        .into_iter()
                        .map(|c| MetadataImage {
                            url: StoredUrl::Url(c.url),
                        })
                        .collect(),
                ),
            },
            album
                .tracks
                .into_iter()
                .map(|t| PartialMetadataWithoutId {
                    title: t.name,
                    identifier: t.id,
                    lot: MediaLot::Music,
                    is_recommendation: None,
                    source: MediaSource::YoutubeMusic,
                    image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                })
                .collect(),
        ))
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<MetadataGroupSearchResponse> {
        let data = self.client.music_search_albums(query).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: data
                .items
                .items
                .into_iter()
                .map(|t| MetadataGroupSearchItem {
                    parts: None,
                    name: t.name,
                    identifier: t.id,
                    image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                })
                .collect(),
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<MetadataPerson> {
        let data = self.client.music_artist(identifier, false).await?;
        let related = if let Some(playlist_id) = data.tracks_playlist_id {
            let items = self.client.music_playlist(playlist_id).await?;
            items
                .tracks
                .items
                .into_iter()
                .map(|t| MetadataPersonRelated {
                    character: None,
                    role: "Artist".to_string(),
                    metadata: PartialMetadataWithoutId {
                        title: t.name,
                        identifier: t.id,
                        lot: MediaLot::Music,
                        is_recommendation: None,
                        source: MediaSource::YoutubeMusic,
                        image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                    },
                })
                .collect()
        } else {
            vec![]
        };
        let identifier = data.id;
        Ok(MetadataPerson {
            related,
            place: None,
            gender: None,
            website: None,
            name: data.name,
            birth_date: None,
            death_date: None,
            source_specifics: None,
            description: data.description,
            identifier: identifier.clone(),
            source: MediaSource::YoutubeMusic,
            source_url: Some(format!("https://music.youtube.com/channel/{}", identifier)),
            images: Some(
                self.largest_image(&data.header_image)
                    .into_iter()
                    .map(|t| t.url.to_owned())
                    .collect(),
            ),
        })
    }

    async fn people_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _source_specifics: &Option<PersonSourceSpecifics>,
        _display_nsfw: bool,
    ) -> Result<PeopleSearchResponse> {
        let data = self.client.music_search_artists(query).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: 1,
                next_page: None,
            },
            items: data
                .items
                .items
                .into_iter()
                .map(|t| PeopleSearchItem {
                    name: t.name,
                    identifier: t.id,
                    birth_year: None,
                    image: self.largest_image(&t.avatar).map(|t| t.url.to_owned()),
                })
                .collect(),
        })
    }
}
