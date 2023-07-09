---
Recommended-Order: 4
---

#location #region [[Hyrule]]

Lanayru is the wet and wild heart of Hyrule, and the home of the proud Zora people. Ancient ruins such as Lanayru Road and the Spring of Wisdom dot the landscape. A small fishing village popped up recently, but has already run into trouble. The region is protected by the Dragon Naydra who files over periodically.

### Locations

* [[Lanayru Wetlands]]
	* [[Goponga Village]]
* [[Lanayru Great Spring]]
	- [[Zora's Domain]]
	- [[Upland Zorana Tower]]
* [[Mount Lanayru]]
* [[Lanayru Sea]]

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

| d6  | Random Rumor                                                                                                                                                                                                                                                          |
|:---:|:--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | "The large lake where Divine Beast Vah Ruta once stood is now almost entirely drained. We're all very worried since we don't know the cause, and our sages have detected an evil eminence from the area." ([[4. Reflecting Pool Dungeon]])                          |
|  2  | "One of our bravest explorers has been pressing deeper into Mount Lanayru, and told us that she found the remains of an ancient spring. There was a statue there glowing with magic, but she was too afraid to touch it." ([[4. Spring of Wisdom]])                      |
|  3  |                                                                                                                                                                                                                                                                       |
|  4  | "Lightning monsters are known to gather along the Ruto Mountain Path on the way to Zora's Domain. It's almost like they know that the Zora are vulnerable to lightning!" ([[4. Ruto Mountain Path]])                                                                  |
|  5  |                                                                                                                                                                                                                                                                       |
|  6  | "The Soldiers' Guild has recently completed Akkala Citadel Town north of here. While they put on a straight face, I've heard of a lot of rumors about monster attacks. Seems like things aren't as rosey as they want people to think." (see Citadel Tunnels dungeon) |
^lanayru-random-rumor

### Random Encounters (18+)

Most of the Lanayru Region is forest, mountain, or water, in which monsters are common. There are many paths that are safe though.

|  d12  | Wilderness Encounter                               |
|:-----:|:-------------------------------------------------- |
|   1   | `encounter: 1: Yiga Footsoldier`                   |
|  2-4  | `encounter: 1d4: Blue Bokoblin, 1: Black Bokoblin` |
|  5-7  | `encounter: 1d6: ChuChu` (Blue and Green)          |
| 8-10  | `encounter: 1d3: Blue Lizalfos`                    |
| 11-12 | `encounter: 1d3: Blue Moblin`                      |
^lanayru-random-wilderness

|  d12  | Water Encounter                 |
|:-----:|:------------------------------- |
|  1-3  | `encounter: 1d6: ChuChu` (Blue)   |
|  4-6  | `encounter: 1d3: Octorok` |
|  7-9  | `encounter: 1d6: Tektite`      |
| 10-12 | `encounter: 1d4: Blue Lizalfos` |
^lanayru-random-water
