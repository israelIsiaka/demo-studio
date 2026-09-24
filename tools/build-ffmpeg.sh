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
# On Windows the compiler is mingw, which links against its own runtime DLLs
# (libwinpthread-1.dll and friends). Those exist on a build machine and on a CI
# runner - GitHub's Windows image ships MSYS2 - and on nobody else's computer,
# where the binary then refuses to start at all. Link them in.
EXTRA=()
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) EXTRA+=(--extra-ldflags="-static -static-libgcc -static-libstdc++") ;;
esac

echo "==> configure"
./configure \
  --prefix="$OUT" \
  "${EXTRA[@]+"${EXTRA[@]}"}" \
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

# And that it can actually run on a machine that is not this one. A mingw build
# that quietly depends on libwinpthread-1.dll works everywhere it is built and
# nowhere it is sent, which is exactly the kind of failure a user sees first.
if command -v objdump >/dev/null 2>&1; then
  for dll in $(objdump -p "$BIN" 2>/dev/null | awk '/DLL Name:/ {print tolower($3)}' | sort -u); do
    case "$dll" in
      libwinpthread*|libgcc*|libstdc*|*msys*|libiconv*|libz*)
        echo "REFUSING: needs $dll, which will not be on a user's computer"; exit 1;;
    esac
  done
  echo "    links: self-contained (no mingw runtime DLLs)"
fi
echo "    at: $BIN"
