# Test data

Freely licensed files used by unit tests (`tests/unit`) and app checks (`tests/e2e`).

| File | Type | What it is | Source / licence |
|---|---|---|---|
| `ode-to-joy-piano.musicxml` | MusicXML 4.0 | Beethoven "Ode to Joy" theme, two-hand piano (treble + bass staves), chord symbols, lyrics, rehearsal marks, tempo 100. 16 bars, 108 notes. | Written for musicGenie by `tests/fixtures/make-ode-to-joy.mjs`. Melody public domain; arrangement CC0. |
| `bach-prelude-c-bwv846.mid` | MIDI (format 1) | J. S. Bach, WTC I Prelude No. 1 in C, BWV 846 (2 note tracks, 35 bars, 549 notes). | Mutopia Project piece 5, https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5 — Public Domain. |
| `full-song.gp` | Guitar Pro 7 | "The crow, the owl and the dove", 11 tracks (guitars, bass, drums, voices...), 96 bars. | alphaTab test data (`packages/alphatab/test-data/conversion/full-song.gp`), https://github.com/CoderLine/alphaTab — MPL-2.0. |
| `hammer.gp5` | Guitar Pro 5 | Hammer-ons / pull-offs on one guitar track. | alphaTab test data (`test-data/guitarpro5/hammer.gp5`) — MPL-2.0. |
| `notes.gp3` | Guitar Pro 3 | Notes across strings and frets. | alphaTab test data (`test-data/guitarpro3/notes.gp3`) — MPL-2.0. |
