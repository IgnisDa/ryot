use anyhow::Result;
use async_trait::async_trait;
use common_models::{
    EntityAssets, MetadataSearchSourceSpecifics, PersonSourceSpecifics, SearchDetails,
};
use common_utils::TEMPORARY_DIRECTORY;
use database_models::metadata_group::MetadataGroupWithoutId;
use dependent_models::{
    MetadataGroupPersonRelated, MetadataPersonRelated, PersonDetails, SearchResults,
};
use enum_models::{MediaLot, MediaSource};
use itertools::Itertools;
use media_models::{
    CommitMetadataGroupInput, MetadataDetails, MetadataGroupSearchItem, MetadataSearchItem,
    MusicSpecifics, PartialMetadataPerson, PartialMetadataWithoutId, PeopleSearchItem,
    UniqueMediaIdentifier,
};
use rustypipe::{
    client::{RustyPipe, RustyPipeQuery},
    model::{Thumbnail, richtext::ToHtml},
};
use traits::MediaProvider;

pub struct YoutubeMusicService {
    client: RustyPipeQuery,
}

impl YoutubeMusicService {
    pub async fn new() -> Result<Self> {
        let client = RustyPipe::builder()
            .storage_dir(TEMPORARY_DIRECTORY)
            .build()?;
        Ok(Self {
            client: client.query(),
        })
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
        let suggestions = match details.related_id {
            None => vec![],
            Some(related_id) => {
                let related = self.client.music_related(related_id).await?.tracks;
                related
                    .into_iter()
                    .map(|t| PartialMetadataWithoutId {
                        title: t.name,
                        identifier: t.id,
                        lot: MediaLot::Music,
                        source: MediaSource::YoutubeMusic,
                        image: self.largest_image(&t.cover).map(|c| c.url.to_owned()),
                        ..Default::default()
                    })
                    .collect()
            }
        };
        let identifier = details.track.id;
        Ok(MetadataDetails {
            suggestions,
            lot: MediaLot::Music,
            title: details.track.name,
            identifier: identifier.clone(),
            source: MediaSource::YoutubeMusic,
            source_url: Some(format!("https://music.youtube.com/watch?v={}", identifier)),
            music_specifics: Some(MusicSpecifics {
                by_various_artists: Some(details.track.by_va),
                duration: details.track.duration.map(|d| d.try_into().unwrap()),
                view_count: details.track.view_count.map(|v| v.try_into().unwrap()),
                ..Default::default()
            }),
            groups: details
                .track
                .album
                .into_iter()
                .map(|a| CommitMetadataGroupInput {
                    name: a.name,
                    unique: UniqueMediaIdentifier {
                        identifier: a.id,
                        lot: MediaLot::Music,
                        source: MediaSource::YoutubeMusic,
                    },
                    ..Default::default()
                })
                .collect(),
            assets: EntityAssets {
                remote_images: self
                    .order_images_by_size(&details.track.cover)
                    .into_iter()
                    .map(|t| t.url)
                    .collect(),
                ..Default::default()
            },
            people: details
                .track
                .artists
                .into_iter()
                .filter_map(|a| {
                    a.id.map(|id| PartialMetadataPerson {
                        name: a.name,
                        identifier: id,
                        role: "Artist".to_string(),
                        source: MediaSource::YoutubeMusic,
                        ..Default::default()
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
        _source_specifics: &Option<MetadataSearchSourceSpecifics>,
    ) -> Result<SearchResults<MetadataSearchItem>> {
        let results = self.client.music_search_tracks(query).await?;
        let data = SearchResults {
            details: SearchDetails {
                total: 100,
                ..Default::default()
            },
            items: results
                .items
                .items
                .into_iter()
                .map(|i| MetadataSearchItem {
                    title: i.name,
                    identifier: i.id,
                    image: self.largest_image(&i.cover).map(|t| t.url.to_owned()),
                    ..Default::default()
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
                source: MediaSource::YoutubeMusic,
                parts: album.tracks.len().try_into().unwrap(),
                description: album.description.map(|d| d.to_html()),
                source_url: album
                    .playlist_id
                    .map(|id| format!("https://music.youtube.com/playlist?list={}", id)),
                assets: EntityAssets {
                    remote_images: self
                        .largest_image(&album.cover)
                        .into_iter()
                        .map(|c| c.url)
                        .collect(),
                    ..Default::default()
                },
            },
            album
                .tracks
                .into_iter()
                .map(|t| PartialMetadataWithoutId {
                    title: t.name,
                    identifier: t.id,
                    lot: MediaLot::Music,
                    source: MediaSource::YoutubeMusic,
                    image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                    ..Default::default()
                })
                .collect(),
        ))
    }

    async fn metadata_group_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
    ) -> Result<SearchResults<MetadataGroupSearchItem>> {
        let data = self.client.music_search_albums(query).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: 100,
                ..Default::default()
            },
            items: data
                .items
                .items
                .into_iter()
                .map(|t| MetadataGroupSearchItem {
                    name: t.name,
                    identifier: t.id,
                    image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                    ..Default::default()
                })
                .collect(),
        })
    }

    async fn person_details(
        &self,
        identifier: &str,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<PersonDetails> {
        let data = self.client.music_artist(identifier, true).await?;
        let related_metadata = match data.tracks_playlist_id {
            None => vec![],
            Some(playlist_id) => {
                let items = self.client.music_playlist(playlist_id).await?;
                items
                    .tracks
                    .items
                    .into_iter()
                    .map(|t| MetadataPersonRelated {
                        role: "Artist".to_string(),
                        metadata: PartialMetadataWithoutId {
                            title: t.name,
                            identifier: t.id,
                            lot: MediaLot::Music,
                            source: MediaSource::YoutubeMusic,
                            image: self.largest_image(&t.cover).map(|t| t.url.to_owned()),
                            ..Default::default()
                        },
                        ..Default::default()
                    })
                    .collect()
            }
        };
        let related_metadata_groups = data
            .albums
            .into_iter()
            .map(|a| MetadataGroupPersonRelated {
                role: "Artist".to_string(),
                metadata_group: MetadataGroupWithoutId {
                    title: a.name,
                    lot: MediaLot::Music,
                    identifier: a.id.clone(),
                    source: MediaSource::YoutubeMusic,
                    assets: EntityAssets {
                        remote_images: self
                            .largest_image(&a.cover)
                            .into_iter()
                            .map(|c| c.url)
                            .collect(),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            })
            .collect();
        let identifier = data.id;
        Ok(PersonDetails {
            name: data.name,
            related_metadata,
            related_metadata_groups,
            description: data.description,
            identifier: identifier.clone(),
            source: MediaSource::YoutubeMusic,
            source_url: Some(format!("https://music.youtube.com/channel/{}", identifier)),
            assets: EntityAssets {
                remote_images: self
                    .largest_image(&data.header_image)
                    .into_iter()
                    .map(|t| t.url.to_owned())
                    .collect(),
                ..Default::default()
            },
            ..Default::default()
        })
    }

    async fn people_search(
        &self,
        query: &str,
        _page: Option<i32>,
        _display_nsfw: bool,
        _source_specifics: &Option<PersonSourceSpecifics>,
    ) -> Result<SearchResults<PeopleSearchItem>> {
        let data = self.client.music_search_artists(query).await?;
        Ok(SearchResults {
            details: SearchDetails {
                total: 100,
                ..Default::default()
            },
            items: data
                .items
                .items
                .into_iter()
                .map(|t| PeopleSearchItem {
                    name: t.name,
                    identifier: t.id,
                    image: self.largest_image(&t.avatar).map(|t| t.url.to_owned()),
                    ..Default::default()
                })
                .collect(),
        })
    }
}
