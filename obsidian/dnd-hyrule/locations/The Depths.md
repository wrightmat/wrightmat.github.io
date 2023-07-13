---
Recommended-Order: 10
---

#location #region [[Hyrule]]

The Depths are the deepest underground system underneath Hyrule that was uncovered during the Upheaval. After the Demon King was destroyed, the chasms that allowed access to The Depths closed, so access to the area is once again restricted.

There is a rumor that another access exists, and has since the Era of Hylia, when a great door was constructed to gate off the area from the Surface above.

The Yiga Clan has continued to stake their claim to The Depths since they initially discovered it prior to the Upheaval.

### Locations

* [[Gorondia]]
* [[Tobio's Hollow]] (elevator to access)

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

### Faction: The Yiga Clan

![[Yiga Clan]]

### Collecting

#### Foraging

| d12 | Collectible    | Qty (12) |
| --- | -------------- | -------- |
| 1-4 | Bomb Flower    | 4        |
| 5-7 | Muddle Bud     | 4        |
| 8-9 | Ironshroom     | 2        |
| 10  | Endura Carrot  | 1        |
| 11  | Hearty Truffle | 1        |
^depths-foraging

#### No Fishing


### Random Encounters (12+)

The Depths is crawling with extremely dangerous and extremely ancient monsters. If someone were to attempt exploration of The Depths, it would be incredibly dangerous.

| d12 | Depths Encounter |
|:---:|:--------------------- |
|  1  |                       |
| 2-3 |                       |
| 4-5 |                       |
| 6-7 |                       |
| 8-9 |                       |
| 10  |                       |
| 11  |                       |
| 12  |                       |
^depths-random-encounter
