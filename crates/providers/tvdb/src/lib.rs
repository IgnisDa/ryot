mod base;
pub use base::TvdbService;

mod models;

mod movies;
pub use movies::TvdbMovieService;

mod non_metadata;
pub use non_metadata::NonMediaTvdbService;

mod shows;
pub use shows::TvdbShowService;
