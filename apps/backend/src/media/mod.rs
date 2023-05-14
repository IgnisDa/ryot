use serde::{Deserialize, Serialize};

use crate::{
    audio_books::AudioBookSpecifics, books::BookSpecifics, movies::MovieSpecifics,
    podcasts::PodcastSpecifics, shows::ShowSpecifics, video_games::VideoGameSpecifics,
};

pub mod resolver;

pub static LIMIT: i32 = 10;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum MediaSpecifics {
    AudioBook(AudioBookSpecifics),
    Book(BookSpecifics),
    Movie(MovieSpecifics),
    Show(ShowSpecifics),
    VideoGame(VideoGameSpecifics),
    Podcast(PodcastSpecifics),
}
