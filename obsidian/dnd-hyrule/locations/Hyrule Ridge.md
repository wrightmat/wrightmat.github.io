#location [[Hebra Region]]

Hyrule Ridge is the eastern area of Hebra between the Central Region and Tabantha Frontier. The area is composed largely of swamp and bog, where rain is incredibly common.

### Locations

* [[Serenne Stable]]
* Thundra Plateau
* Ludfo's Bog
* Breach of Demise
* Lindor's Brow
* Mount Rhoam
* Seres Scablands
* West Hyrule Plains

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

| d12 | Collectible      | Qty (12) |
| --- | ---------------- | -------- |
| 1-2 | Rushroom         | 2        |
| 3-4 | Armoranth        | 2        |
| 5-6 | Tabantha Wheat   | 2        |
| 7   | Warm Safflina    | 1        |
| 8   | Electic Safflina | 1        |
| 9   | Endura Carrot    | 1        |
| 10  | Endura Shroom    | 1        |
| 11  | Stamella Shroom  | 1        |
| 12  | Silent Princess  | 1        |
^hyrule-ridge-foraging

##### Fishing

| d6  | Collectible   | Qty (6) |
| --- | ------------- | ------- |
| 1-5 | Voltfin Trout | 5       |
| 6   | Hearty Salmon | 1       |
^hyrule-ridge-fishing
