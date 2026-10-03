#!/usr/bin/env bash
# Download raw source data into raw/. Idempotent: skips files already present.
# Every download is checked against scripts/sources.sha256 so builds stay reproducible.
# Tatoeba only publishes its latest export: if it changed, the check fails; rerun with
# --relock to accept the new data (this changes the generated curriculum).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p raw
LOCK=scripts/sources.sha256
DOWNLOADS=(raw/kanjivg-*-main.zip raw/kanji-data.json raw/jlpt-vocab-n?.csv raw/jmdict-eng.json.zip
  raw/JmdictFurigana.json raw/jpn_sentences.tsv.bz2 raw/jpn_indices.tar.bz2 raw/eng_sentences.tsv.bz2)

KANJIVG_TAG="r20260714"
KANJIVG_ZIP="kanjivg-${KANJIVG_TAG#r}-main.zip"

get() { # url dest
  if [[ -s "$2" ]]; then echo "have  $2"; else echo "fetch $2"; curl -fsSL "$1" -o "$2.part" && mv "$2.part" "$2"; fi
}

# Stroke order + stroke paths (CC BY-SA 3.0)
get "https://github.com/KanjiVG/kanjivg/releases/download/${KANJIVG_TAG}/${KANJIVG_ZIP}" "raw/${KANJIVG_ZIP}"
if [[ ! -d raw/kanjivg ]]; then
  unzip -q "raw/${KANJIVG_ZIP}" -d raw/kanjivg.tmp && mv raw/kanjivg.tmp raw/kanjivg
fi

# Kanji metadata: KANJIDIC2 readings/meanings + tanos N5..N1 levels (MIT / CC BY-SA for KANJIDIC part)
get "https://raw.githubusercontent.com/davidluzgouveia/kanji-data/00fd7079c3890f430759536f91aa5e854ec0ca4f/kanji.json" "raw/kanji-data.json"

# JLPT vocab lists (tanos), mapped to JMdict entry ids
for n in 5 4 3 2 1; do
  get "https://raw.githubusercontent.com/stephenmk/yomitan-jlpt-vocab/b062d4e38c4bdd0950ae1d4ec55f04b176182e03/original_data/n${n}.csv" "raw/jlpt-vocab-n${n}.csv"
done

# JMdict English (EDRDG, CC BY-SA 4.0) via jmdict-simplified
JMDICT_TAG="3.6.2%2B20260928191014"
get "https://github.com/scriptin/jmdict-simplified/releases/download/${JMDICT_TAG}/jmdict-eng-${JMDICT_TAG}.json.zip" "raw/jmdict-eng.json.zip"
if [[ ! -s raw/jmdict-eng.json ]]; then
  unzip -p raw/jmdict-eng.json.zip > raw/jmdict-eng.json.part && mv raw/jmdict-eng.json.part raw/jmdict-eng.json
fi

# Per-kanji reading split of every JMdict word (CC BY-SA 4.0)
FURI_TAG="2.3.1%2B2026-09-25"
get "https://github.com/Doublevil/JmdictFurigana/releases/download/${FURI_TAG}/JmdictFurigana.json" "raw/JmdictFurigana.json"

# Example sentences: Tatoeba (CC BY 2.0 FR). jpn_indices = Tanaka corpus word index (B-lines),
# linking each Japanese sentence to its English translation and to JMdict headwords + readings.
get "https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2" "raw/jpn_sentences.tsv.bz2"
get "https://downloads.tatoeba.org/exports/jpn_indices.tar.bz2" "raw/jpn_indices.tar.bz2"
get "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2" "raw/eng_sentences.tsv.bz2"
[[ -s raw/jpn_sentences.tsv ]] || bunzip2 -k raw/jpn_sentences.tsv.bz2
[[ -s raw/eng_sentences.tsv ]] || bunzip2 -k raw/eng_sentences.tsv.bz2
[[ -s raw/jpn_indices.csv ]] || tar -xjf raw/jpn_indices.tar.bz2 -C raw

if [[ "${1:-}" == "--relock" || ! -s $LOCK ]]; then
  sha256sum ${DOWNLOADS[@]} > $LOCK
  echo "wrote $LOCK"
else
  sha256sum --quiet -c $LOCK || { echo "source data differs from $LOCK (see above); use --relock to accept" >&2; exit 1; }
fi
echo done
