FROM ignisda/archlinux:latest

USER root

USER $USERNAME
RUN cargo binstall sea-orm-cli cargo-dist cargo-release --locked --secure --no-confirm
