---
Recommended-Order: 6
---

#location #region [[Hyrule]]

Eldin is a vast Region in northern Hyrule, split into two distinct halves. The eastern side is a largely mountainous stretch of land that consists densely of foothills, deep gorges, and volcanic activity. The western half, which belonged to the Central region until just after the second Calamity, is composed primarily of the Great Hyrule Forest. The region is protected by the Dragon Dinraal who flies over periodically.

Some outdoor areas of Eldin, such as Death Mountain, are extremely hot and will require checks if PCs aren't prepared. These checks are not required inside of dungeons or for cooler areas such as forests.

### Locations

- [[Death Mountain]]
* [[Eldin Canyon]]
	* [[Foothill Stable]]
	- [[Goron City]]
- [[Eldin Mountains]]
- [[Great Hyrule Forest]]
	- [[Korok Forest]]
	- [[Woodland Stable]]

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

| d6  | Random Rumor                                                                                                                                                                                                                                                             |
|:---:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|  1  | "Should anyone in your group have need for potion or poison, a witch is always your best bet. I've heard there's one who lives outside of town, but I could never travel that far." ([[6. Visit to the Witch's Hut]])                                                    |
|  2  | "The great flame dragon, Dinraal, used to frequent the area at the foot of Gut Check Rock, but hasn't been seen in decades. I've heard the dragon's faithful are still around, and have even built a new temple to him in a volcano." ([[6. Temple of the Volcano God]]) |
|  3  | "The Great Deku Tree can be found in the middle of Korok Forest. He is the patron diety of a group known as the Deku Protectorate, who believe that the natural order must be respected and preserved." ([[Korok Forest]])                                               |
|  4  |                                                                                                       |
|  5  | "The Goron City is surrounded by a number of different mines. I heard a rumor recently about trouble in one of the mines that has prevented the Gorons from entering it." ([[6. Abandoned Mine Dungeon]])                                                              |
|  6  | "If you travel far enough west from here, you'll encounter the Hebra and Tabantha regions. They're kind of the opposite of here, cold and wet." ([[Hebra Region]])                                                                                                       |
^eldin-random-rumor

### Random Encounters (15+)

Most of the Eldin Region is mountainous, with hot springs, volcanic vents, and winding paths, where monsters are common. There are also heavily forested regions where monsters are equally common.

| d12 | Mountain Encounter               |
|:---:|:-------------------------------- |
|  1  | `encounter: 1: Yiga Footsoldier` |
| 2-3 | `encounter: 1d6: ChuChu` (Red)     |
| 4-5 | `encounter: 1d3: Pebblit` (Igneo)  |
| 6-7 | `encounter: 1d8: Keese` (Fire)     |
| 8-9 | `encounter: 1d3: Black Lizalfos` (Fire)  |
| 10  | `encounter: 1: Black Moblin`     |
| 11  | `encounter: 1: Red Hinox`        |
| 12  | `encounter: 1: Wizzrobe` (Fire)    |
^eldin-random-mountain

| d12 | Forest Encounter                 |
|:---:|:-------------------------------- |
|  1  | `encounter: 1: Yiga Footsoldier` |
| 2-3 | `encounter: 1d6: ChuChu` (Green)   |
| 4-5 | `encounter: 1d3: Skulltulas`     |
| 6-7 | `encounter: 1d8: Keese`          |
| 8-9 | `encounter: 1d3: Black Lizalfos` |
| 10  | `encounter: 1d3: Octorok`        |
| 11  | `encounter: 1: Black Moblin`     |
| 12  | `encounter: 1: Blue Hinox`      |
^eldin-random-forest
