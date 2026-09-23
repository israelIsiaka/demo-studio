#!/usr/bin/env bash
# Builds the FFmpeg that Demo Studio ships: LGPL only, no GPL, no nonfree, and
# only the pieces the app actually uses.
#
# The app never re-encodes video (it copies the stream) and only ever encodes
# audio, so nothing here needs libx264 - which is what makes a stock build GPL.
#
#   ./build-ffmpeg.sh [version] [output dir]
set -euo pipefail

VERSION="${1:-7.1.1}"
OUT="${2:-$PWD/ffmpeg-out}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> fetching FFmpeg $VERSION"
curl -fsSL "https://ffmpeg.org/releases/ffmpeg-$VERSION.tar.xz" -o "$WORK/ffmpeg.tar.xz"
tar -xf "$WORK/ffmpeg.tar.xz" -C "$WORK"
cd "$WORK/ffmpeg-$VERSION"

# Encoders: AAC for the finished video's soundtrack, PCM for the WAV the voice
# recorder writes. Decoders and demuxers stay broad on purpose - people upload
# whatever their phone recorded.
# Filters: exactly the chain in render.py, plus the resamplers FFmpeg inserts.
echo "==> configure"
./configure \
  --prefix="$OUT" \
  --disable-gpl --disable-nonfree --disable-version3 \
  --disable-doc --disable-debug --disable-network --disable-autodetect \
  --disable-programs --enable-ffmpeg \
  --disable-encoders \
  --enable-encoder=aac,pcm_s16le,pcm_f32le \
  --disable-muxers \
  --enable-muxer=mp4,wav,ipod,mov \
  --disable-filters \
  --enable-filter=aformat,anull,aresample,atrim,atempo,adelay,amix,volume,asplit,sidechaincompress,alimiter,acopy,copy,null \
  --disable-bsfs --enable-bsf=aac_adtstoasc,extract_extradata \
  --enable-pic \
  > "$WORK/configure.log" 2>&1 || { tail -30 "$WORK/configure.log"; exit 1; }

echo "==> build"
make -j"$(getconf _NPROCESSORS_ONLN)" > "$WORK/make.log" 2>&1 || { tail -30 "$WORK/make.log"; exit 1; }
make install > /dev/null 2>&1

BIN="$OUT/bin/ffmpeg"
echo "==> built $("$BIN" -version | head -1)"
echo "    size: $(du -h "$BIN" | cut -f1)"
# The whole point: prove there is no GPL or nonfree code in what we ship.
CONF="$("$BIN" -version | grep -o 'configuration:.*')"
for forbidden in enable-gpl enable-nonfree enable-libx264; do
  case "$CONF" in *"--$forbidden"*) echo "REFUSING: build contains --$forbidden"; exit 1;; esac
done
echo "    licence: LGPL only (no --enable-gpl, --enable-nonfree, --enable-libx264)"
echo "    at: $BIN"
