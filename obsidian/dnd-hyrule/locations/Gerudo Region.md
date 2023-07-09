---
Recommended-Order: 8
---

#location #region [[Hyrule]]

The Gerudo region is made up of the Gerudo Desert and the Gerudo Highlands. It is home of the Gerudo people and the original home of the villainous Yiga Clan.

The Gerudo Desert alternates between being extremely hot during the day and extremely cold at night, while the Gerudo Highlands are always extremely cold.

### Locations

* [[Gerudo Highlands]]
- [[Gerudo Desert]]
	- [[Kara Kara Bazaar]]
	- [[Gerudo Town]]

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

| d6  | Random Rumor                                                                                                                                                                                                          |
|:---:|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | "A strange shrine has risen out of the desert in Toruma Dunes, west of Gerudo Town. No one knows where it came from, or why it's here, but we have to assume the Yiga are involved" ([[8. Shrine of Shifting Sands]]) |
|  2  | "Have you heard about the seven giant statues that are east of Gerudo Town? They're said to be depictions of ancient heroines, believed to be the divine protectors of the Gerudo." (Shrine of the Seven)             |
|  3  | "There's rumored to be a great magical fairy who lives in the far reaches of the desert. But no one in recent memory has been able to make the trek out there to meet her." ([[8. Great Fairy Tera]])                 |
|  4  |                                                                                                                                                                                                                       |
|  5  |                                                                                                                                                                                                                       |
|  6  |                                                                                                                                                                                                                       |
^gerudo-random-rumor

### Random Encounters (15+)

Most of the Gerudo Region is desert, where monsters are common.

| Roll | Desert Encounter                            |
|:----:|:------------------------------------------- |
|  1   | `encounter: 2: Yiga Footsoldier`            |
| 2-3  | `encounter: 1d6: ChuChu` (Red and Yellow)   |
| 4-5  | `encounter: 1d3: Pebblit` (Igneo)           |
| 6-7  | `encounter: 1d8: Keese` (Electric)          |
| 8-9  | `encounter: 1d3: Black Lizalfos` (Electric) |
|  10  | `encounter: 1: Black Moblin`                |
|  12  | `encounter: 1: Wizzrobe` (Electric)         |
|  11  | `encounter: 1: Molduga`                     |
^gerudo-random-desert
