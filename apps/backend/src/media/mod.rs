use serde::{Deserialize, Serialize};

use crate::{
    audio_books::AudioBookSpecifics, books::BookSpecifics, movies::MovieSpecifics,
    shows::ShowSpecifics, video_games::VideoGameSpecifics,
};

pub mod resolver;

pub static LIMIT: i32 = 20;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum MediaSpecifics {
    AudioBook(AudioBookSpecifics),
    Book(BookSpecifics),
    Movie(MovieSpecifics),
    Show(ShowSpecifics),
    VideoGame(VideoGameSpecifics),
}
