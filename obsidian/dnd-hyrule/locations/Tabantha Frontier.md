#location  [[Hebra Region]]

The Tabantha Frontier is the western edge of the Hebra region, and thereby the western edge of Hyrule.

### Locations

* [[Rito Village]]
* Lake Totori
* Warbler's Nest
* Hebra Trailhead Lodge
* Ancient Columns
* Tanagar Canyon
* Cuho Mountain
* Dragon Bone Mire
* Gisa Crater
* Great Fairy Fountain (Kaysa)
* Kolami Bridge
* Nero Hill
* Passer Hill
* Piper Ridge
* Rayne Highlands
* Strock Lake
* Tabantha Hills
* Tama Pond

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Collecting

##### Foraging

| d12  | Collectible          | Qty (12) |
| ---- | -------------------- | -------- |
| 1-3  | Hylian Grains        | 3        |
| 4-6  | Razorshroom          | 3        |
| 7-8  | Hylian Tomato Pepper | 2        |
| 9-10 | Swift Violet         | 2        |
| 11   | Courser Bee Honey    | 1        |
| 12   | Fairy                | 1        |
^tabantha-frontier-foraging

##### Fishing

| d6  | Collectible    | Qty (6) |
| --- | -------------- | ------- |
| 1-3 | Chillfin Trout | 3       |
| 4-5 | Voltfin Trout  | 2       |
| 6   | Hearty Salmon  | 1       |
^tabantha-frontier-fishing
