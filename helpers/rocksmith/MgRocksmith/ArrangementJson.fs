/// Compact JSON <-> Rocksmith 2014 instrumental arrangement (Rocksmith2014.XML).
/// Times are integer milliseconds; strings are 0-based (0 = lowest); masks are the library's raw bits.
module MgRocksmith.ArrangementJson

open System
open System.Collections.Generic
open System.Text.Json.Nodes
open Rocksmith2014.XML
open MgRocksmith.Json

// ---------- arrangement -> JSON ----------

let private noteJson (n: Note) : JsonNode =
    let bends =
        if isNull n.BendValues then jarr []
        else n.BendValues |> Seq.map (fun b -> jarr [ jint b.Time; jnum (float b.Step) ]) |> jarr
    jobj [
        "t", jint n.Time
        "s", jint (int n.String)
        "f", jint (int n.Fret)
        "sus", jint n.Sustain
        "mask", jint (int n.Mask)
        "slideTo", jint (int n.SlideTo)
        "slideUnpitchTo", jint (int n.SlideUnpitchTo)
        "tap", jint (int n.Tap)
        "vib", jint (int n.Vibrato)
        "lh", jint (int n.LeftHand)
        "bends", bends
    ]

let private chordNoteCount (arr: InstrumentalArrangement) (c: Chord) =
    if c.HasChordNotes then c.ChordNotes.Count
    elif int c.ChordId >= 0 && int c.ChordId < arr.ChordTemplates.Count then
        arr.ChordTemplates[int c.ChordId].Frets |> Seq.filter (fun f -> f >= 0y) |> Seq.length
    else 0

/// Notes in the hardest level of every phrase (what a player sees at 100% difficulty).
let hardestCounts (arr: InstrumentalArrangement) : JsonNode =
    let pis = arr.PhraseIterations
    let mutable singles = 0
    let mutable chords = 0
    let mutable chordNotes = 0
    for i in 0 .. pis.Count - 1 do
        let pi = pis[i]
        let startT = pi.Time
        let endT = if i + 1 < pis.Count then pis[i + 1].Time else Int32.MaxValue
        let phrase = arr.Phrases[pi.PhraseId]
        let lvlIndex = min (int phrase.MaxDifficulty) (arr.Levels.Count - 1)
        if lvlIndex >= 0 then
            let lvl = arr.Levels[lvlIndex]
            for n in lvl.Notes do
                if n.Time >= startT && n.Time < endT then singles <- singles + 1
            for c in lvl.Chords do
                if c.Time >= startT && c.Time < endT then
                    chords <- chords + 1
                    chordNotes <- chordNotes + chordNoteCount arr c
    jobj [
        "singleNotes", jint singles
        "chords", jint chords
        "chordNotes", jint chordNotes
        "total", jint (singles + chordNotes)
    ]

/// The whole arrangement. Call after RemoveDD() to get one level with every note.
let toJson (arr: InstrumentalArrangement) : JsonNode =
    let md = arr.MetaData
    let lvl = if arr.Levels.Count > 0 then arr.Levels[arr.Levels.Count - 1] else Level()
    let props = md.ArrangementProperties
    jobj [
        "title", jstr md.Title
        "artist", jstr md.ArtistName
        "album", jstr md.AlbumName
        "year", jint md.AlbumYear
        "arrangement", jstr md.Arrangement
        "tuning", md.Tuning.Strings |> Seq.map int |> jints
        "capo", jint (int md.Capo)
        "centOffset", jnum (float md.CentOffset)
        "songLength", jint md.SongLength
        "averageTempo", jnum (float md.AverageTempo)
        "pathBass", jbool props.PathBass
        "pathLead", jbool props.PathLead
        "pathRhythm", jbool props.PathRhythm
        "bassPick", jbool props.BassPick
        "beats", arr.Ebeats |> Seq.map (fun b -> jarr [ jint b.Time; jint (int b.Measure) ]) |> jarr
        "phrases", arr.Phrases |> Seq.map (fun p -> jobj [ "name", jstr p.Name; "maxDifficulty", jint (int p.MaxDifficulty) ]) |> jarr
        "phraseIterations", arr.PhraseIterations |> Seq.map (fun p -> jarr [ jint p.Time; jint p.PhraseId ]) |> jarr
        "sections", arr.Sections |> Seq.map (fun s -> jobj [ "name", jstr s.Name; "t", jint s.Time; "n", jint (int s.Number) ]) |> jarr
        "chordTemplates",
            arr.ChordTemplates
            |> Seq.map (fun c ->
                jobj [
                    "name", jstr c.Name
                    "displayName", jstr c.DisplayName
                    "frets", c.Frets |> Seq.map int |> jints
                    "fingers", c.Fingers |> Seq.map int |> jints
                ])
            |> jarr
        "notes", lvl.Notes |> Seq.map noteJson |> jarr
        "chords",
            lvl.Chords
            |> Seq.map (fun c ->
                jobj [
                    "t", jint c.Time
                    "id", jint (int c.ChordId)
                    "mask", jint (int c.Mask)
                    "notes", (if c.HasChordNotes then c.ChordNotes |> Seq.map noteJson |> jarr else jarr [])
                ])
            |> jarr
        "anchors", lvl.Anchors |> Seq.map (fun a -> jarr [ jint a.Time; jint (int a.Fret); jint (int a.Width) ]) |> jarr
        "handShapes", lvl.HandShapes |> Seq.map (fun h -> jarr [ jint (int h.ChordId); jint h.StartTime; jint h.EndTime ]) |> jarr
        "tone", jstr arr.Tones.BaseToneName
    ]

// ---------- JSON -> arrangement ----------

let private noteFromJson (j: JsonNode) =
    let n = Note()
    n.Time <- getInt j "t" 0
    n.String <- sbyte (getInt j "s" 0)
    n.Fret <- sbyte (getInt j "f" 0)
    n.Sustain <- getInt j "sus" 0
    n.Mask <- LanguagePrimitives.EnumOfValue<uint16, NoteMask>(uint16 (getInt j "mask" 0))
    n.SlideTo <- sbyte (getInt j "slideTo" -1)
    n.SlideUnpitchTo <- sbyte (getInt j "slideUnpitchTo" -1)
    n.Tap <- sbyte (getInt j "tap" 0)
    n.Vibrato <- byte (getInt j "vib" 0)
    n.LeftHand <- sbyte (getInt j "lh" -1)
    let bends = items (get j "bends")
    if not bends.IsEmpty then
        let bv = List<BendValue>()
        for b in bends do
            let p = items b
            bv.Add(BendValue(toInt p[0], float32 (toFloat p[1])))
        n.BendValues <- bv
        n.MaxBend <- bv |> Seq.map (fun b -> b.Step) |> Seq.max
    n

let fromJson (j: JsonNode) : InstrumentalArrangement =
    let arr = InstrumentalArrangement()
    let md = arr.MetaData
    md.Title <- getStr j "title" "Untitled"
    md.TitleSort <- md.Title
    md.ArtistName <- getStr j "artist" "Unknown"
    md.ArtistNameSort <- md.ArtistName
    md.AlbumName <- getStr j "album" ""
    md.AlbumNameSort <- md.AlbumName
    md.AlbumYear <- getInt j "year" DateTime.Now.Year
    md.Arrangement <- getStr j "arrangement" "Lead"
    md.Capo <- sbyte (getInt j "capo" 0)
    md.CentOffset <- float32 (getFloat j "centOffset" 0.0)
    md.SongLength <- getInt j "songLength" 0
    md.AverageTempo <- float32 (getFloat j "averageTempo" 120.0)
    items (get j "tuning") |> List.iteri (fun i v -> if i < 6 then md.Tuning.Strings[i] <- int16 (toInt v))
    let props = md.ArrangementProperties
    props.PathBass <- getBool j "pathBass" false
    props.PathLead <- getBool j "pathLead" false
    props.PathRhythm <- getBool j "pathRhythm" false
    props.BassPick <- getBool j "bassPick" false
    props.Represent <- true
    props.StandardTuning <- md.Tuning.Strings |> Seq.forall (fun s -> s = 0s)

    for b in items (get j "beats") do
        let p = items b
        arr.Ebeats.Add(Ebeat(toInt p[0], int16 (toInt p[1])))
    for p in items (get j "phrases") do
        arr.Phrases.Add(Phrase(getStr p "name" "", byte (getInt p "maxDifficulty" 0), PhraseMask.None))
    for pi in items (get j "phraseIterations") do
        let p = items pi
        arr.PhraseIterations.Add(PhraseIteration(toInt p[0], toInt p[1]))
    for s in items (get j "sections") do
        arr.Sections.Add(Section(getStr s "name" "riff", getInt s "t" 0, int16 (getInt s "n" 1)))
    for c in items (get j "chordTemplates") do
        let frets = items (get c "frets") |> List.map (toInt >> sbyte) |> List.toArray
        let fingers = items (get c "fingers") |> List.map (toInt >> sbyte) |> List.toArray
        arr.ChordTemplates.Add(ChordTemplate(getStr c "name" "", getStr c "displayName" "", fingers, frets))

    let notes = List<Note>()
    for n in items (get j "notes") do
        notes.Add(noteFromJson n)
    let chords = List<Chord>()
    for c in items (get j "chords") do
        let ch = Chord()
        ch.Time <- getInt c "t" 0
        ch.ChordId <- int16 (getInt c "id" 0)
        ch.Mask <- LanguagePrimitives.EnumOfValue<byte, ChordMask>(byte (getInt c "mask" 0))
        let cn = items (get c "notes")
        if not cn.IsEmpty then
            ch.ChordNotes <- List<Note>(cn |> List.map noteFromJson)
        chords.Add(ch)
    let anchors = List<Anchor>()
    for a in items (get j "anchors") do
        let p = items a
        anchors.Add(Anchor(sbyte (toInt p[1]), toInt p[0], sbyte (toInt p[2])))
    let handShapes = List<HandShape>()
    for h in items (get j "handShapes") do
        let p = items h
        handShapes.Add(HandShape(int16 (toInt p[0]), toInt p[1], toInt p[2]))
    arr.Levels.Add(Level(0y, notes, chords, anchors, handShapes))
    arr.TranscriptionTrack <- Level()

    let tone = getStr j "tone" ""
    if tone <> "" then arr.Tones.BaseToneName <- tone
    arr
