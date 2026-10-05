# Data license and attributions

The source code of this project is MIT-licensed (see [LICENSE](LICENSE)). The
**data** it ships is derived from dictionaries released under Creative Commons
Attribution-ShareAlike licences, so these files are licensed under
**[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**:

- `data/curriculum.yaml`
- `web/data/curriculum.json`
- `web/data/kanji.json`
- `web/icons/*` (drawn from KanjiVG's stroke paths of 字)

You may share and adapt them, including commercially, as long as you give
appropriate credit (to this project and to the sources below) and distribute
your adaptations under the same licence.

They are built by the scripts in `scripts/` from the sources below; nothing in
them is entered by hand.

## Sources

| Source | Used for | Copyright / author | Licence |
|---|---|---|---|
| [KanjiVG](https://kanjivg.tagaini.net) | stroke paths, stroke order, components; the app icon | © Ulrich Apel | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) | kanji meanings, readings, grade, frequency | © Electronic Dictionary Research and Development Group | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project) | word meanings, parts of speech, usage notes | © Electronic Dictionary Research and Development Group | [CC BY-SA 4.0](https://www.edrdg.org/edrdg/licence.html) |
| [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) | JMdict in JSON form | [scriptin](https://github.com/scriptin) | CC BY-SA 4.0 |
| [JmdictFurigana](https://github.com/Doublevil/JmdictFurigana) | how each word's reading splits across its kanji | [Doublevil](https://github.com/Doublevil) | CC BY-SA 4.0 (as JMdict) |
| [JLPT Resources](http://www.tanos.co.uk/jlpt/) | JLPT kanji and vocabulary levels | Jonathan Waller | CC BY |
| [yomitan-jlpt-vocab](https://github.com/stephenmk/yomitan-jlpt-vocab) | Waller's vocabulary lists mapped to JMdict entries | [stephenmk](https://github.com/stephenmk) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| [kanji-data](https://github.com/davidluzgouveia/kanji-data) | KANJIDIC and Waller's JLPT kanji levels in JSON form (only these fields are used) | © David Gouveia | MIT (notice below) |
| [Tatoeba](https://tatoeba.org) (incl. the Tanaka Corpus) | example sentences and their translations | Tatoeba contributors | [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/) |

The KANJIDIC2 and JMdict files are used in conformance with the Electronic
Dictionary Research and Development Group's
[licence](https://www.edrdg.org/edrdg/licence.html).

Example sentences come from Tatoeba; each one's sentence id is kept in
`data/curriculum.yaml` (`tatoeba:` field), and its page and authors are at
`https://tatoeba.org/sentences/show/<id>`. Where a sentence contains kanji not
yet taught at that point of the curriculum, those words are rewritten in
hiragana.

The JLPT lists are unofficial: the JLPT has not published vocabulary or kanji
lists since 2010.

## kanji-data notice

```
MIT License

Copyright (c) 2019 David Gouveia

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

## Build-time tools (not distributed)

kuromoji (Apache 2.0, with the IPADIC dictionary) is used only while building
the curriculum, to write unlearned kanji in example sentences in hiragana.
Wrangler, yaml and resvg are development tools. None of them is part of the
published app or data.
