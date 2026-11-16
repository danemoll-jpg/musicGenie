/// musicGenie Rocksmith helper.
///
/// Protocol: one JSON request per line on stdin  {"id":1,"cmd":"read","args":{...}}
///           one JSON reply per line on stdout     {"id":1,"ok":true,"result":{...}} | {"id":1,"ok":false,"error":"..."}
/// Progress lines may also appear:                 {"id":1,"progress":"converting audio"}
/// One-shot use from a shell:  MgRocksmith.exe <cmd> [<json args> | <psarc path>]
///
/// Commands: ping, findWwise, findRocksmith, list, read (.psarc), readProject (.rs2dlc), readXml, check, write.
module MgRocksmith.Program

open System
open System.IO
open System.Text
open System.Text.Json.Nodes
open Microsoft.Win32
open Rocksmith2014.Common
open Rocksmith2014.Common.Manifest
open Rocksmith2014.DD
open Rocksmith2014.DLCProject
open Rocksmith2014.PSARC
open Rocksmith2014.XML
open Rocksmith2014.XML.Processing
open Rocksmith2014.Audio
open MgRocksmith.Json

let version = "musicGenie Rocksmith helper 1.0 (Rocksmith2014.NET v3.5.0)"

let mutable private currentId: JsonNode = null
let private out = Console.OpenStandardOutput()
let private writeLine (n: JsonNode) =
    let bytes = Encoding.UTF8.GetBytes(serialize n + "\n")
    lock out (fun () ->
        out.Write(bytes, 0, bytes.Length)
        out.Flush())

let progress (msg: string) =
    writeLine (jobj [ "id", (if isNull currentId then null else currentId.DeepClone()); "progress", jstr msg ])

// ---------------- Wwise ----------------

let findWwise () : JsonNode =
    try
        let path = Wwise.getCLIPath ()
        let v = Diagnostics.FileVersionInfo.GetVersionInfo(path)
        jobj [ "found", jbool true; "path", jstr path; "version", jstr v.ProductVersion ]
    with e ->
        let launcher = @"C:\Program Files\Wwise Launcher\Wwise Launcher.exe"
        jobj [
            "found", jbool false
            "error", jstr e.Message
            "launcherInstalled", jbool (File.Exists launcher)
        ]

// ---------------- Rocksmith / Steam ----------------

let private steamRoots () =
    let fromReg (hive: RegistryKey) (key: string) (value: string) =
        try
            use k = hive.OpenSubKey(key)
            if isNull k then None else k.GetValue(value) |> Option.ofObj |> Option.map string
        with _ -> None
    [ fromReg Registry.CurrentUser @"Software\Valve\Steam" "SteamPath"
      fromReg Registry.LocalMachine @"SOFTWARE\WOW6432Node\Valve\Steam" "InstallPath"
      fromReg Registry.LocalMachine @"SOFTWARE\Valve\Steam" "InstallPath"
      Some @"C:\Program Files (x86)\Steam" ]
    |> List.choose id
    |> List.map (fun p -> p.Replace('/', '\\'))
    |> List.distinct
    |> List.filter Directory.Exists

let findRocksmith () : JsonNode =
    let libraries =
        steamRoots ()
        |> List.collect (fun root ->
            let vdf = Path.Combine(root, "steamapps", "libraryfolders.vdf")
            let extra =
                if File.Exists vdf then
                    Text.RegularExpressions.Regex.Matches(File.ReadAllText vdf, "\"path\"\\s+\"([^\"]+)\"")
                    |> Seq.map (fun m -> m.Groups[1].Value.Replace(@"\\", @"\"))
                    |> Seq.toList
                else []
            root :: extra)
        |> List.distinctBy (fun p -> p.TrimEnd('\\').ToLowerInvariant())
    // Steam libraries first, then the usual hand-moved places on every fixed drive.
    let drives =
        DriveInfo.GetDrives()
        |> Array.filter (fun d -> d.DriveType = DriveType.Fixed && d.IsReady)
        |> Array.map (fun d -> d.RootDirectory.FullName)
        |> Array.toList
    let candidates =
        (libraries |> List.map (fun lib -> Path.Combine(lib, "steamapps", "common", "Rocksmith2014")))
        @ (drives |> List.collect (fun d ->
            [ Path.Combine(d, "Rocksmith2014")
              Path.Combine(d, "SteamLibrary", "steamapps", "common", "Rocksmith2014")
              Path.Combine(d, "Games", "Rocksmith2014") ]))
    let games =
        candidates
        |> List.filter (fun dir -> File.Exists(Path.Combine(dir, "Rocksmith2014.exe")))
        |> List.distinctBy (fun p -> p.ToLowerInvariant())
    jobj [
        "steamLibraries", libraries |> List.map jstr |> jarr
        "gameFolders", games |> List.map jstr |> jarr
        "dlcFolder", (match games with g :: _ -> jstr (Path.Combine(g, "dlc")) | [] -> null)
    ]

// ---------------- read ----------------

let listPsarc (path: string) : JsonNode =
    use psarc = PSARC.OpenFile(path)
    jobj [ "file", jstr path; "entries", psarc.Manifest |> List.map jstr |> jarr ]

let private hardestCountsSafe (xml: InstrumentalArrangement) =
    try ArrangementJson.hardestCounts xml with e -> jobj [ "error", jstr e.Message ]

let private chordNotes (xml: InstrumentalArrangement) (c: Chord) =
    if c.HasChordNotes then c.ChordNotes.Count
    else xml.ChordTemplates[int c.ChordId].Frets |> Seq.filter (fun f -> f >= 0y) |> Seq.length

/// One instrumental arrangement as JSON with every note (difficulty levels merged into one).
let instrumentalJson (inst: Instrumental option) (xml: InstrumentalArrangement) : JsonNode =
    let levels = xml.Levels.Count
    let hardest = hardestCountsSafe xml
    if levels > 1 then xml.RemoveDD(false).GetAwaiter().GetResult()
    let body = ArrangementJson.toJson xml
    let o = body :?> JsonObject
    match inst with
    | Some inst ->
        o["name"] <- jstr (string inst.Name)
        o["priority"] <- jstr (string inst.Priority)
        o["bassPicked"] <- jbool inst.BassPicked
        o["xmlPath"] <- jstr inst.XmlPath
    | None ->
        let p = xml.MetaData.ArrangementProperties
        let name =
            if p.PathBass then "Bass"
            elif p.PathRhythm then "Rhythm"
            elif p.PathLead then "Lead"
            else (match xml.MetaData.Arrangement with null -> "Lead" | a -> a)
        o["name"] <- jstr name
        o["priority"] <- jstr (if p.BonusArrangement then "Bonus" else "Main")
    o["levels"] <- jint levels
    o["hardest"] <- hardest
    o["noteCountAfterRemoveDD"] <-
        jint ((xml.Levels |> Seq.sumBy (fun l -> l.Notes.Count))
              + (xml.Levels |> Seq.sumBy (fun l -> l.Chords |> Seq.sumBy (chordNotes xml))))
    body

/// A DLC Builder project (.rs2dlc): its arrangement XML files and audio, as for a .psarc.
let readProject (args: JsonNode) : JsonNode =
    let path = getStr args "rs2dlc" (getStr args "psarc" "")
    if not (File.Exists path) then failwith $"File not found: {path}"
    let project = (DLCProject.load path).GetAwaiter().GetResult()
    let arrangements =
        project.Arrangements
        |> List.choose (function
            | Arrangement.Instrumental inst when File.Exists inst.XmlPath ->
                Some (instrumentalJson (Some inst) (InstrumentalArrangement.Load inst.XmlPath))
            | _ -> None)
    let audio = project.AudioFile.Path
    let playable =
        [ audio; Path.ChangeExtension(audio, "wav"); Path.ChangeExtension(audio, "ogg") ]
        |> List.tryFind (fun p -> File.Exists p && not (p.EndsWith(".wem", StringComparison.OrdinalIgnoreCase)))
    jobj [
        "title", jstr project.Title.Value
        "artist", jstr project.ArtistName.Value
        "album", jstr project.AlbumName.Value
        "year", jint project.Year
        "dlcKey", jstr project.DLCKey
        "audioWav", (match playable with Some p -> jstr p | None -> null)
        "previewStart", (match project.AudioPreviewStartTime with Some t -> jnum t.TotalMilliseconds | None -> null)
        "albumArt", jstr project.AlbumArtFile
        "arrangements", arrangements |> jarr
    ]

/// A single Rocksmith arrangement XML file.
let readXml (args: JsonNode) : JsonNode =
    let path = getStr args "xml" ""
    if not (File.Exists path) then failwith $"File not found: {path}"
    let xml = InstrumentalArrangement.Load path
    let md = xml.MetaData
    jobj [
        "title", jstr md.Title
        "artist", jstr md.ArtistName
        "album", jstr md.AlbumName
        "year", jint md.AlbumYear
        "arrangements", jarr [ instrumentalJson None xml ]
    ]

let readPsarc (args: JsonNode) : JsonNode =
    let path = getStr args "psarc" ""
    let outDir = getStr args "outDir" (Path.Combine(Path.GetTempPath(), "mg-psarc-" + Guid.NewGuid().ToString("N")))
    if not (File.Exists path) then failwith $"File not found: {path}"
    Directory.CreateDirectory(outDir) |> ignore
    let entries = (listPsarc path |> fun n -> get n "entries").DeepClone()
    progress "unpacking"
    let result = (PsarcImporter.import (fun () -> ()) path outDir).GetAwaiter().GetResult()
    let project = result.GeneratedProject

    progress "converting audio"
    let audioOgg =
        try
            Conversion.wemToOgg project.AudioFile.Path
            jstr (Path.ChangeExtension(project.AudioFile.Path, "ogg"))
        with e ->
            eprintfn "audio conversion failed: %s" e.Message
            null

    // Charts made with the Toolkit also carry their source XML: count its hardest level as a cross-check.
    let sourceXmls =
        try
            use psarc = PSARC.OpenFile(path)
            psarc.Manifest
            |> List.filter (fun e ->
                e.StartsWith("songs/arr/") && e.EndsWith(".xml") && not (e.Contains "showlights") && not (e.Contains "vocals"))
            |> List.map (fun e ->
                let target = Path.Combine(outDir, "source_" + Path.GetFileName e)
                psarc.InflateFile(e, target).GetAwaiter().GetResult()
                Path.GetFileNameWithoutExtension(e).ToLowerInvariant(), target)
        with _ -> []
    let sourceCounts (xmlPath: string) : JsonNode =
        let part = Path.GetFileNameWithoutExtension(xmlPath).ToLowerInvariant().Replace("arr_", "").Replace("_rs2", "")
        match sourceXmls |> List.tryFind (fun (name, _) -> name.EndsWith("_" + part)) with
        | Some (_, file) ->
            try
                let counts = ArrangementJson.hardestCounts (InstrumentalArrangement.Load file)
                (counts :?> JsonObject)["file"] <- jstr file
                counts
            with e -> jobj [ "error", jstr e.Message ]
        | None -> null

    progress "reading arrangements"
    let arrangements =
        result.ArrangementData
        |> List.choose (fun (arr, data) ->
            match arr, data with
            | Arrangement.Instrumental inst, PsarcImportTypes.ImportedData.Instrumental xml ->
                let body = instrumentalJson (Some inst) xml
                (body :?> JsonObject)["sourceXmlHardest"] <- sourceCounts inst.XmlPath
                Some body
            | _ -> None)

    jobj [
        "title", jstr project.Title.Value
        "artist", jstr project.ArtistName.Value
        "album", jstr project.AlbumName.Value
        "year", jint project.Year
        "dlcKey", jstr project.DLCKey
        "outDir", jstr outDir
        "projectPath", jstr result.ProjectPath
        "audioWem", jstr project.AudioFile.Path
        "audioOgg", audioOgg
        "audioVolume", jnum project.AudioFile.Volume
        "previewStart", (match project.AudioPreviewStartTime with Some t -> jnum t.TotalMilliseconds | None -> null)
        "albumArt", jstr project.AlbumArtFile
        "buildTool", (match result.BuildToolVersion with Some v -> jstr v | None -> null)
        "entries", entries
        "arrangements", arrangements |> jarr
    ]

// ---------------- check ----------------

let private issueJson (arrName: string) (i: Issue) : JsonNode =
    let t = i.IssueType
    let name =
        let s = sprintf "%A" t
        s.Replace("\n", " ").Replace("  ", " ")
    let isWarning =
        match t with
        | PossiblyWrongChordFingering | BarreOverOpenStrings | AnchorCloseToUnpitchedSlide | MoreThan100Phrases
        | LowBassTuningWithoutWorkaround | IncorrectLowBassTuningForTuningPitch -> true
        | _ -> false
    jobj [
        "arrangement", jstr arrName
        "type", jstr name
        "severity", jstr (if isWarning then "warning" else "error")
        "timeMs", (match i.TimeCode with Some tc -> jint tc | None -> null)
    ]

let checkArrangement (arrName: string) (xml: InstrumentalArrangement) : JsonNode list =
    ArrangementChecker.checkInstrumental xml |> Seq.map (issueJson arrName) |> Seq.toList

let checkXml (args: JsonNode) : JsonNode =
    let path = getStr args "xml" ""
    let xml = InstrumentalArrangement.Load(path)
    let issues = checkArrangement (Path.GetFileNameWithoutExtension path) xml
    jobj [ "xml", jstr path; "issues", jarr issues ]

// ---------------- write ----------------

let private loadTone (kind: string) (key: string) : Tone =
    let file = Path.Combine(AppContext.BaseDirectory, "tones", $"default_{kind}.json")
    let tone = (Tone.fromJsonFile file).GetAwaiter().GetResult()
    { tone with Key = key; Name = key }

let private safeName (s: string) =
    let cleaned = String(s |> Seq.filter (fun c -> Char.IsLetterOrDigit c || c = '-' || c = ' ') |> Seq.toArray)
    let t = cleaned.Trim().Replace(' ', '-')
    if t = "" then "Untitled" else t

let private makeAlbumArt (path: string) (title: string) =
    use img = new ImageMagick.MagickImage(ImageMagick.MagickColor("#2d3a6b"), 512u, 512u)
    // A simple diagonal band so the art is not a flat square; no fonts needed.
    use band = new ImageMagick.MagickImage(ImageMagick.MagickColor("#e0a33a"), 512u, 96u)
    img.Composite(band, 0, 360, ImageMagick.CompositeOperator.Over)
    img.Format <- ImageMagick.MagickFormat.Png
    img.Write(path)

let writePsarc (args: JsonNode) : JsonNode =
    let outDir = getStr args "outDir" ""
    if outDir = "" then failwith "outDir is required"
    Directory.CreateDirectory(outDir) |> ignore
    let title = getStr args "title" "Untitled"
    let artist = getStr args "artist" "Unknown"
    let album = getStr args "album" ""
    let year = getInt args "year" DateTime.Now.Year
    let author = getStr args "author" "musicGenie"
    let dlcKey =
        match getStr args "dlcKey" "" with
        | "" -> DLCKey.create author artist title
        | k -> k
    let fileBase = $"{safeName artist}_{safeName title}_v1"

    // 1. Arrangement XML files + checks
    progress "writing arrangements"
    let arrangementSpecs = items (get args "arrangements")
    if arrangementSpecs.IsEmpty then failwith "No arrangements to export."
    let mutable issues: JsonNode list = []
    let mutable ddInfo: JsonNode list = []
    let used = Collections.Generic.HashSet<string>()
    let instrumentals =
        arrangementSpecs
        |> List.map (fun spec ->
            let name = getStr spec "name" "Lead"
            let arrName =
                match name with
                | "Bass" -> ArrangementName.Bass
                | "Rhythm" -> ArrangementName.Rhythm
                | "Combo" -> ArrangementName.Combo
                | _ -> ArrangementName.Lead
            let priority =
                match getStr spec "priority" "Main" with
                | "Bonus" -> ArrangementPriority.Bonus
                | "Alternative" -> ArrangementPriority.Alternative
                | _ -> ArrangementPriority.Main
            let routeMask =
                match arrName with
                | ArrangementName.Bass -> RouteMask.Bass
                | ArrangementName.Rhythm -> RouteMask.Rhythm
                | _ -> RouteMask.Lead
            let mutable fileName = $"arr_{name.ToLowerInvariant()}_RS2.xml"
            let mutable k = 2
            while not (used.Add fileName) do
                fileName <- $"arr_{name.ToLowerInvariant()}{k}_RS2.xml"
                k <- k + 1
            let xmlPath = Path.Combine(outDir, fileName)
            let toneKey = $"{dlcKey}_{name}_{k - 1}".Replace(" ", "")
            let o = (spec.DeepClone()) :?> JsonObject
            o["title"] <- jstr title
            o["artist"] <- jstr artist
            o["album"] <- jstr album
            o["year"] <- jint year
            o["arrangement"] <- jstr name
            o["tone"] <- jstr toneKey
            let xml = ArrangementJson.fromJson o
            xml.Save(xmlPath)
            issues <- issues @ checkArrangement name xml
            // Try the difficulty-level generator now (the package builder runs it again at build time).
            let ddLevels =
                try
                    let copy = InstrumentalArrangement.Load(xmlPath)
                    Generator.generateForArrangement { PhraseSearchThreshold = Some 80; LevelCountGeneration = LevelCountGeneration.Simple } copy |> ignore
                    copy.Levels.Count
                with e ->
                    eprintfn "DD generation failed: %s" e.Message
                    -1
            ddInfo <- ddInfo @ [ jobj [ "arrangement", jstr name; "xml", jstr xmlPath; "ddLevels", jint ddLevels ] ]
            let tuning = xml.MetaData.Tuning.Strings |> Array.copy
            let inst =
                { Instrumental.Empty with
                    Id = ArrangementId.New
                    XmlPath = xmlPath
                    Name = arrName
                    RouteMask = routeMask
                    Priority = priority
                    Tuning = tuning
                    BaseTone = toneKey
                    BassPicked = getBool spec "bassPicked" false
                    MasterId = RandomGenerator.next ()
                    PersistentId = Guid.NewGuid() }
            let toneKind = match routeMask with RouteMask.Bass -> "bass" | RouteMask.Rhythm -> "rhythm" | _ -> "lead"
            inst, loadTone toneKind toneKey)

    // 2. Album art, audio, preview
    progress "preparing audio and album art"
    let albumArt =
        match getStr args "albumArt" "" with
        | p when p <> "" && File.Exists p -> p
        | _ ->
            let p = Path.Combine(outDir, "cover.png")
            makeAlbumArt p title
            p
    let audioSrc = getStr args "audioWav" ""
    if not (File.Exists audioSrc) then failwith $"Audio file not found: {audioSrc}"
    let audioWav = Path.Combine(outDir, $"{dlcKey}.wav")
    if not (String.Equals(Path.GetFullPath audioSrc, Path.GetFullPath audioWav, StringComparison.OrdinalIgnoreCase)) then
        File.Copy(audioSrc, audioWav, true)
    let previewWav = Path.Combine(outDir, $"{dlcKey}_preview.wav")
    let previewStart = TimeSpan.FromMilliseconds(getFloat args "previewStartMs" 0.0)
    Preview.create audioWav previewWav previewStart
    let audioLength = Rocksmith2014.Audio.Utils.getLength audioWav

    let project =
        { DLCProject.Empty with
            Author = Some author
            DLCKey = dlcKey
            ArtistName = SortableString.Create(artist)
            Title = SortableString.Create(title)
            AlbumName = SortableString.Create(album)
            Year = year
            AlbumArtFile = albumArt
            AudioFile = { Path = audioWav; Volume = getFloat args "volume" -7.0 }
            AudioFileLength = Some audioLength
            AudioPreviewFile = { Path = previewWav; Volume = getFloat args "volume" -7.0 }
            AudioPreviewStartTime = Some previewStart
            Arrangements = instrumentals |> List.map (fun (i, _) -> Arrangement.Instrumental i)
            Tones = instrumentals |> List.map snd }

    // 3. DLC Builder project, so the export can always be finished by hand.
    let rs2dlc = Path.Combine(outDir, $"{fileBase}.rs2dlc")
    (DLCProject.save rs2dlc project).GetAwaiter().GetResult()

    let baseResult (stage: string) (extra: (string * JsonNode) list) =
        jobj ([
            "stage", jstr stage
            "dlcKey", jstr dlcKey
            "outDir", jstr outDir
            "rs2dlc", jstr rs2dlc
            "audioWav", jstr audioWav
            "previewWav", jstr previewWav
            "albumArt", jstr albumArt
            "xmlFiles", instrumentals |> List.map (fun (i, _) -> jstr i.XmlPath) |> jarr
            "issues", jarr issues
            "arrangements", ddInfo |> List.map (fun n -> n.DeepClone()) |> jarr
        ] @ extra)

    let hasErrors = issues |> List.exists (fun i -> getStr i "severity" "" = "error")
    if hasErrors && not (getBool args "ignoreIssues" false) then
        baseResult "checks" [ "error", jstr "The arrangement checks found problems (see issues). Nothing was converted." ]
    else
    // 4. Wwise: convert the audio. Stop here (keeping everything above) if it cannot.
    progress "converting audio with Wwise"
    let wwiseCli = match getStr args "wwiseConsole" "" with "" -> None | p -> Some p
    let wwiseError =
        try
            Wwise.convertToWem wwiseCli audioWav |> Async.RunSynchronously |> ignore
            Wwise.convertToWem wwiseCli previewWav |> Async.RunSynchronously |> ignore
            None
        with e -> Some e.Message
    match wwiseError with
    | Some err ->
        baseResult "wwise" [ "error", jstr ("Wwise could not convert the audio: " + err) ]
    | None ->
        // 5. Build the package (SNG conversion, DD levels, manifest, sound banks).
        progress "building package"
        let config: PackageBuilder.BuildConfig =
            { Platforms = [ PC ]
              BuilderVersion = version
              Author = author
              AppId = AppId.CherubRock
              GenerateDD = true
              ForcePhraseCreation = false
              DDConfig = { PhraseSearchThreshold = Some 80; LevelCountGeneration = LevelCountGeneration.Simple }
              ApplyImprovements = true
              SaveDebugFiles = false
              AudioConversionTask = async { return () }
              IdResetConfig = None
              ProgressReporter = None }
        let target = PackageBuilder.WithoutPlatformOrExtension(Path.Combine(outDir, fileBase))
        let paths, _ = PackageBuilder.buildPackages target config project |> Async.RunSynchronously
        let psarc = paths |> Array.tryHead |> Option.defaultValue (Path.Combine(outDir, fileBase + "_p.psarc"))
        let copied =
            match getStr args "copyToDlc" "" with
            | "" -> null
            | dir when Directory.Exists dir ->
                let dest = Path.Combine(dir, Path.GetFileName psarc)
                File.Copy(psarc, dest, true)
                jstr dest
            | dir -> failwith $"The Rocksmith dlc folder does not exist: {dir}"
        baseResult "done" [ "psarc", jstr psarc; "copiedTo", copied ]

// ---------------- dispatch ----------------

let run (cmd: string) (args: JsonNode) : JsonNode =
    match cmd with
    | "ping" -> jobj [ "version", jstr version ]
    | "findWwise" -> findWwise ()
    | "findRocksmith" -> findRocksmith ()
    | "list" -> listPsarc (getStr args "psarc" "")
    | "read" -> readPsarc args
    | "readProject" -> readProject args
    | "readXml" -> readXml args
    | "check" -> checkXml args
    | "write" -> writePsarc args
    | other -> failwith $"Unknown command: {other}"

let private parseArgs (s: string) : JsonNode =
    if String.IsNullOrWhiteSpace s then JsonObject() :> JsonNode
    elif s.TrimStart().StartsWith("{") then JsonNode.Parse(s)
    else jobj [ "psarc", jstr s; "xml", jstr s ]

let private reply (id: JsonNode) (f: unit -> JsonNode) =
    currentId <- id
    let res =
        try
            jobj [ "id", (if isNull id then null else id.DeepClone()); "ok", jbool true; "result", f () ]
        with e ->
            let msg = Rocksmith2014.DLCProject.Utils.distinctExceptionMessages e
            jobj [ "id", (if isNull id then null else id.DeepClone()); "ok", jbool false; "error", jstr msg ]
    currentId <- null
    writeLine res

[<EntryPoint>]
let main argv =
    Console.InputEncoding <- Encoding.UTF8
    if argv.Length > 0 then
        let args = if argv.Length > 1 then parseArgs argv[1] else JsonObject() :> JsonNode
        reply null (fun () -> run argv[0] args)
        0
    else
        let mutable line = Console.In.ReadLine()
        while not (isNull line) do
            if not (String.IsNullOrWhiteSpace line) then
                let req = try JsonNode.Parse(line) with _ -> null
                if isNull req then
                    writeLine (jobj [ "ok", jbool false; "error", jstr "Bad request (not JSON)." ])
                else
                    reply (get req "id") (fun () -> run (getStr req "cmd" "") (get req "args"))
            line <- Console.In.ReadLine()
        0
