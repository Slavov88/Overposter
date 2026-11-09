FROM alpine:3.23.2
ARG VERSION=0.16.9
RUN apk add --no-cache ca-certificates curl fontconfig && \
    curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${VERSION}/tectonic-${VERSION}-x86_64-unknown-linux-musl.tar.gz" -o /tmp/tectonic.tgz && \
    echo '60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902  /tmp/tectonic.tgz' | sha256sum -c - && \
    tar -xzf /tmp/tectonic.tgz -C /usr/local/bin tectonic && rm /tmp/tectonic.tgz && \
    addgroup -S -g 10001 poster && adduser -S -D -u 10001 -G poster poster && \
    mkdir -p /work /home/poster/.cache/Tectonic && chown -R poster:poster /work /home/poster
ENV HOME=/home/poster
USER poster
WORKDIR /work
# Cache the actual template/package/font set during image creation. Runtime is offline.
COPY --chown=poster:poster templates /tmp/templates
COPY --chown=poster:poster examples/sample-ml-poster /tmp/sample
RUN set -eu; \
    for theme in academic-classic modern-ml visual-results; do \
      cd "/tmp/templates/$theme"; \
      printf '%s\n' '\def\PosterWidth{841}' '\def\PosterHeight{594}' '\def\PosterTitle{Template example}' '\def\PosterSubtitle{}' '\def\PosterAuthors{}' '\def\PosterAffiliation{}' '\def\PosterContact{}' '\def\PosterPaperURL{}' '\def\PosterFontScale{1}' > config.tex; \
      tectonic -X compile --untrusted --outdir /tmp poster.tex; \
    done; \
    cd /tmp/sample; tectonic -X compile --untrusted --outdir /tmp poster.tex
