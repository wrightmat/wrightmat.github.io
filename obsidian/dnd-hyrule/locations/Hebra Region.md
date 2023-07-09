---
Recommended-Order: 7
---

#location #region [[Hyrule]]

Hebra is a vast region covering the northwestern corner of Hyrule. The Region is very mountainous but also has vast expanses of flat terrain.

Northern outdoor areas of Hebra, such as the Hebra Mountains, are extremely cold and will require checks if PCs aren't prepared when they arrive. These checks are not required inside of dungeons or for warmer areas such as Rito Village, or near hot springs.

### Locations

- [[Hebra Mountains]]
- [[Tabantha Frontier]]
	- [[Rito Village]]
* [[Hyrule Ridge]]
	- [[Serenne Stable]]

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

### Rumors

| d6  | Tale |
|:---:|:---- |
|  1  |      |
|  2  |      |
|  3  |      |
|  4  |      |
|  5  |      |
|  6  |      |
^hebra-random-rumor

### Random Encounters (15+)

Most of the Hebra Region is mountainous, with cold snowy peaks surrounded by cold snowy lowlands, where monsters are common.

| d12 | Wilderness Encounter             |
|:---:|:-------------------------------- |
|  1  | `encounter: 1: Yiga Footsoldier` |
| 2-3 | `encounter: 1d6: ChuChu` (Ice)     |
| 4-5 | `encounter: 1d3: Pebblit` (Ice)  |
| 6-7 | `encounter: 1d8: Keese` (Ice)      |
| 8-9 | `encounter: 1d3: Black Lizalfos` (Ice) |
| 10  | `encounter: 1: Black Moblin`     |
| 11  | `encounter: 1: Blue Hinox`       |
| 12  | `encounter: 1: Wizzrobe` (Ice)     |
^hebra-random-wilderness
