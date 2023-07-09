---
Recommended-Order: 2
---

#location #region [[Hyrule]]

Necluda is a region split into three parts - West Necluda, East Necluda, and the Necluda Sea - all three of which are directly east of the Great Plateau. It is home to two of the most significant villages in Hyrule and will likely be the first location the players visit (as well as potentially their home base). The region is protected by Great Fairy Cotera who resides near Kakariko Village.

Unfortunately, the area south of Kakariko has become poisoned, with the source appearing to come from the Hickaly Woods. The entire eastern Squabble River, and the western section until about the Dueling Peaks, has turned purple and become completely undrinkable. If the situation isn't addressed, then the people of Kakariko and Hateno could be in danger. Once the Week in the Woods (Dungeon) adventure is completed, then the poisonous water recedes, but until then any player touching the water takes 1d8 poison damage for every round spent in the water.

### Locations

* [[West Necluda]]
	- [[Dueling Peaks Stable]]
	- [[Kakariko Village]]
* [[East Necluda]]
	- [[Hateno Town]]
* [[Necluda Sea]]
	* [[Eventide Island]]

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

| d6  | Random Rumor                                                                                                                                                                                                                                                                                |
|:---:|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  1  | "There is a Great Fairy flower near Kakariko, but no one has seen it open in quite some time. Rumor is that if a piece of the fairy's power can be found, then it would open again." ([[2. Great Fairy Cotera]])                                                                            |
|  2  | "The Phalian Highlands area is said to be home to a number of creatures known as Hinoxes. They're giant and have a single large eye. Seems to be a convenient weakness to me!" ([[2. Great Fairy Cotera]])                                                                                  |
|  3  | "The Sheikah Seekers are one of the major guilds in Hyrule, and are headquartered in Kakariko. If you can get in good with them, or any of the guilds, it would surely help your cause." (Seeking the Seekers [[Kakariko Village]])                                                         |
|  4  | "Hateno Town used to be a military stronghold, and still houses a fort, but now it's pretty peaceful. A friend did tell me recently that something odd has been going on at night though." (Evil Waves of Grain [[Hateno Town]])                                                         |
|  5  | "The old man Doza has been running the Dueling Peaks Stable for as long as anyone can remember. I hear he's ready to give up the stable for the right price. Would make a great base of operations, for say, a party of adventurers." (Home Is Where The Heart Is [[Dueling Peaks Stable]]) |
|  6  | "I heard recently that an area of the Faron Woods has been dying and rotting. No one knows what's causing it, but it reeks of evil energy to me." ([[2. Well in the Woods Dungeon]])                                                                                                      |
^necluda-random-rumor

### Random Encounters (18+)

The vast majority of the Necluda Region is safe routes, but in a higher danger environment, except for near cities where it's considered a low danger environment.

| d12 | Wilderness Encounter                               |
|:---:|:-------------------------------------------------- |
|  1  | `encounter: 1: Yiga Footsoldier`                   |
| 2-3 | `encounter: 1d6: Red Bokoblin, 1: Blue Bokoblin`   |
| 4-5 | `encounter: 1d4: Blue Bokoblin, 1: Black Bokoblin` |
|  6  | `encounter: 1d4: ChuChu` (Blue)                      |
|  7  | `encounter: 1d4: ChuChu` (Green)                     |
|  8  | `encounter: 1d6: Keese`                            |
|  9  | `encounter: 1d3: Green Lizalfos`                   |
| 10  | `encounter: 1d4: Red Moblin`                       |
| 11  | `encounter: 1d3: Blue Moblin`                      |
| 12  | `encounter: 1d4: Tektite`                          |
^necluda-random-wilderness

|  d12  | Water Encounter                 |
|:-----:|:------------------------------- |
|  2-4  | `encounter: 1d6: ChuChu` (Blue)   |
|  5-7  | `encounter: 1d3: Octorok` |
| 8-10  | `encounter: 1d6: Tektites`      |
| 11-12 | `encounter: 1d3: Blue Lizalfos` |
^necluda-random-water
