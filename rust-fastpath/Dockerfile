FROM rust:1.85-bookworm AS builder
WORKDIR /app
COPY rust-fastpath/ ./
RUN cargo build --release

FROM debian:bookworm-slim
RUN mkdir -p /var/run/aetherguard-fastpath

COPY --from=builder /app/target/release/aetherguard-fastpath /usr/local/bin/aetherguard-fastpath
ENV PORT=8081
EXPOSE 8081
CMD ["aetherguard-fastpath"]
