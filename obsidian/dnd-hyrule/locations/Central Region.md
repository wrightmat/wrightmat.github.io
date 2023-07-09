---
Recommended-Order: 1
---

#location #region [[Hyrule]]

Central Hyrule is the central region of Hyrule Kingdom, containing the Great Plateau, Hyrule Field and Hyrule Ridge. Central Hyrule was burned in the Great Calamity over a hundred years ago, but has since rebuilt considerably.

### Locations

* [[Hyrule Castle]]
	* [[Hyrule Castle Town]]
* [[Hyrule Field]]
	* [[Central Research Base]]
	* [[Hyrule Field Tower]]
	* [[Lon Lon Ranch]]
	* [[Windvane Village]]
	* [[Maku Tree Sapling]]
	* [[Outskirt Stable]]
* [[Great Plateau]]
	- Temple of Time
	- Eastern Abbey
	- Cartography Chamber

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```

### Rumors

| d6 | Random Rumor |
|:----:|:-------------|
| 1  | "There are a number of rich and powerful Hylians in Castle Town you don't want to cross, especially Lord Seliverous who basically runs the entire east residential district of town." ([[1. Lord and Killer]]) |
| 2  | "The cultural district of Castle Town, known as Hyrule Forest Park, is chalk full of interesting buldings, including a large museum that I've heard may be haunted." ([[1. The Haunted Museum]]) |
| 3  | "Hyrule Castle is heavily guarded, so while anyone is welcome to visit, I wouldn't recommend causing any trouble!" ([[1. Hyrule Castle]]) |
| 4  | "The Great Plateau is the perfect elevated vantage point to see the majority of Hyrule. The Champions of Hyrule who make their home there are also known to help adventurers like yourselves." ([[Great Plateau]]) |
| 5  | "On the Great Plateau, a strong fog rolls in at night, so thick that the remainder of Hyrule below the plateau can't even be seen. Rumor is that spectral figures have also been seen in the fog." (Poes in the Fog) |
| 6  | "Three primary building make up the Great Plateau: the Temple of Time, the Eastern Abbey, and what the Champions call their Cartography Chamber, which was built over an old dilapidated cabin." ([[1. Cartography Chamber]]) |
| 7  | "Some folks decided that Hyrule Castle Town wasn't for them, even as it was rebuilding. They set up a new village south of the field that they call Windvane Village." ([[Windvane Village]]) |
| 8  | "You don't see a lot of animals or agriculture here because most of that is taken care of at Lon Lon Ranch southeast of here, or one of its nearby fields. We do get shipments of their milk though, which is delicious!" ([[Lon Lon Ranch]]) |
^central-random-rumor

### Random Encounters (20+)

The vast majority of the Central Region is safe routes, in a low danger environment.

| d12 | Wilderness Encounter                               |
| --- | -------------------------------------------------- |
| 1   | `encounter: 1: Yiga Footsoldier`                   |
| 2-3 | `encounter: 1d6: Red Bokoblin, 1: Blue Bokoblin`   |
| 4-5 | `encounter: 1d4: Blue Bokoblin, 1: Black Bokoblin` |
| 6   | `encounter: 1d4: Chuchu` (Blue)                    |
| 7   | `encounter: 1d4: Chuchu` (Green)                   |
| 8   | `encounter: 1d6: Keese`                            |
| 9   | `encounter: 1d3: Green Lizalfos`                   |
| 10  | `encounter: 1d4: Red Moblin`                       |
| 11  | `encounter: 1d3: Blue Moblin`                      |
| 12  | `encounter: 1d4: Tektike`                          |
^central-random-wilderness

| d12   | Water Encounter                 |
| ----- | ------------------------------- |
| 2-4   | `encounter: 1d6: Blue ChuChu`   |
| 5-7   | `encounter: 1d3: Octorok` |
| 8-10  | `encounter: 1d6: Tektite`      |
| 11-12 | `encounter: 1d3: Blue Lizalfos` |
^central-random-water
