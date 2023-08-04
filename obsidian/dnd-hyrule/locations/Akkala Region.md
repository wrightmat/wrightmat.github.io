---
Recommended-Order: 5
---

#location #region [[Hyrule]]

The Akkala Region of Hyrule has been rebuilt with a new Citadel and a city to rival old Hyrule Castle Town in size. There is also a Soldiers' Academy, Quartermaster, Infirmary, Barracks, and Tavern here. A complex network of tunnels under the city, likely remaining from the old Citadel, serve as a prison for a very dangerous monster (unbeknownst to the people above). The region is protected by the Great Fairy Mija, who resides near Tarrey Town.

Random tremors all around the region, but specifically focused around the Akkala Citadel, have recently started and are worrying the residents of the area. Little do they know that the tremors are caused by a great underground monster. Once the Citadel Tunnels (Dungeon) adventure is completed, the tremors stop.

### Location

* [[Akkala Highlands]]
	- [[Akkala Citadel Town]]
	- [[Tarrey Town]]
* [[Deep Akkala]]
	- [[Akkala Research Lab]]
	- [[East Akkala Stable]]
* [[Akkala Sea]]
	- [[Lomei Castle Island]]

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

| d6  | Random Rumor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
|:---:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|  1  | "Long ago, during the reign of an ancient King, the name Agellar was spoken throughout the land. Some spoke of him reverently, others as if he were a sick joke played upon them by the monarch. But all agreed that he was one of their ruler's favorites. And perhaps even more so, they spoke of the Coat of Diamonds, an impenetrable suit of armor granted him as a gift from the King. When he died, he was said to be buried in a small tomb in Skull Lake." ([[5. The Tomb of Agellar]]) |
|  2  | "Strange animals have been spotted in the Shadow Pass. I've also heard stories of the water in that area being a milky white." ([[5. A Dream of Spring]])                                                                                                                                                                                                                                                                                                                                        |
|  3  | "There is a Great Fairy's flower near Tarrey Town, but it hasn't been open in some time. Rumor is there's a piece of the fairy's power that can be found someone in the region that would open it up." ([[5. Great Fairy Mija]])                                                                                                                                                                                                                                                                 |
|  4  | "The soldiers at the Citadel are pretty secretive, but sometimes rumors slip out. I heard once that there's a major system of tunnels that run under the Citadel. What it must be like to explore something like that!" ([[5. Citadel Tunnels Dungeon]])                                                                                                                                                                                                                                       |
|  5  | "You know, not all the folks in Hyrule are appreciative of adventurers and their stories. Watch your back when talking about the stuff you've found, you never know when someone may want what you've got." (Not All Heroes... [[East Akkala Stable]])                                                                                                                                                                                                                                           |
|  6  | "The Eldin region is west of here. The Goron people are kind and knowledgeable, so if you need any help or advise go see them in their town at the foot of Death Mountain." ([[Eldin Region]])                                                                                                                                                                                                                                                                                                   |
^akkala-random-rumor

### Random Encounters (18+)

Most of the Akkala Region is wilderness, plains, or swamp, in which monsters are common, but many paths and the presence of soldiers makes it slightly less dangerous.

|  d12  | Wilderness Encounter                               |
|:-----:|:-------------------------------------------------- |
|   1   | `encounter: 1: Yiga Footsoldier`                   |
|  2-4  | `encounter: 1d4: Blue Bokoblin, 1: Black Bokoblin` |
|  5-7  | `encounter: 1d6: ChuChu` (Green and Blue)          |
| 8-10  | `encounter: 1d3: Green Lizalfos`                   |
| 11-12 | `encounter: 1d3: Blue Moblin`                      |
^akkala-random-wilderness

| d12 | Water Encounter                      |
|:---:|:------------------------------------ |
| 2-3 | `encounter: 1d6: ChuChu` (Blue)      |
| 4-5 | `encounter: 1d3: Octorok`            |
| 6-7 | `encounter: 1d6: Tektite`            |
| 8-9 | `encounter: 1d4: Blue Lizalfos`      |
| 10  | `encounter: 1d3: Blue Moblin`        |
| 11  | `encounter: 1d4: Pebblit`            |
| 12  | `encounter: 1: Wizzrobe` (Lightning) |
^akkala-random-water
