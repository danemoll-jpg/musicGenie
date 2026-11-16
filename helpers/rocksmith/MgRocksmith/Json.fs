/// Small helpers over System.Text.Json.Nodes (no reflection-based serialisation of F# types).
module MgRocksmith.Json

open System.Text.Json
open System.Text.Json.Nodes

let jobj (props: (string * JsonNode) list) : JsonNode =
    let o = JsonObject()
    for (k, v) in props do
        o[k] <- v
    o :> JsonNode

let jarr (items: JsonNode seq) : JsonNode =
    let a = JsonArray()
    for i in items do
        a.Add(i)
    a :> JsonNode

let jstr (s: string) : JsonNode = if isNull s then null else JsonValue.Create(s) :> JsonNode
let jnum (n: float) : JsonNode = JsonValue.Create(n) :> JsonNode
let jint (n: int) : JsonNode = JsonValue.Create(n) :> JsonNode
let jbool (b: bool) : JsonNode = JsonValue.Create(b) :> JsonNode

let jints (xs: int seq) = xs |> Seq.map jint |> jarr

let get (o: JsonNode) (key: string) : JsonNode =
    match o with
    | :? JsonObject as jo ->
        match jo.TryGetPropertyValue(key) with
        | true, v -> v
        | _ -> null
    | _ -> null

let has (o: JsonNode) key = not (isNull (get o key))

let asFloat (v: JsonNode) : float =
    match v with
    | :? JsonValue as jv ->
        match jv.TryGetValue<float>() with
        | true, f -> f
        | _ ->
            match jv.TryGetValue<int>() with
            | true, i -> float i
            | _ -> float (jv.GetValue<int64>())
    | _ -> 0.0

let getStr (o: JsonNode) key (dflt: string) =
    match get o key with
    | null -> dflt
    | v -> v.GetValue<string>()

let getInt (o: JsonNode) key (dflt: int) =
    match get o key with
    | null -> dflt
    | v -> int (System.Math.Round(asFloat v))

let getFloat (o: JsonNode) key (dflt: float) =
    match get o key with
    | null -> dflt
    | v -> asFloat v

let getBool (o: JsonNode) key (dflt: bool) =
    match get o key with
    | null -> dflt
    | v -> v.GetValue<bool>()

let items (n: JsonNode) : JsonNode list =
    match n with
    | :? JsonArray as a -> a |> Seq.toList
    | _ -> []

let toInt (n: JsonNode) = int (System.Math.Round(asFloat n))
let toFloat (n: JsonNode) = asFloat n

let serialize (n: JsonNode) =
    n.ToJsonString(JsonSerializerOptions(WriteIndented = false))
