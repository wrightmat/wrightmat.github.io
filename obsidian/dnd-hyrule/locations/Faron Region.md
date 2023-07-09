---
Recommended-Order: 3
---

#location #region [[Hyrule]]

Faron Region is a large tropical jungle area in the far southeastern part of Hyrule, to the East of Lake Hylia and South of Hateno. Faron is comprised of dense jungle trees and high cliffs and peaks - and full of dangerous monsters. The region is protected by the Dragon Farosh who flies over periodically.

The area is mostly normal, save for the west half of Lake Hylia that has inexplicitly frozen over recently.

### Locations

* [[Lake Hylia]]
	* [[Highland Stable]]
* [[Faron Grasslands]]
	- [[Lakeside Stable]]
	- [[Lurelin Village]]
* [[Faron Sea]]

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

* Martha's Landing - something to do with a mermaid? Like in Link's Awakening

### Rumors

| d6 | Random Rumor |
|:----:|:-------------|
| 1  | "I heard recently that an area of the woods between Faron and Necluda has been dying and rotting. No one knows what's causing it, but it reeks of evil energy to me." ([[2. Well in the Woods Dungeon]]) |
| 2  | "The ruins north east of Pagos Woods are said to have once belonged to the ancient barbarian tribe known as the Zonai. Who knows what interesting weapons or magic could be buried in those ruins." ([[3. The Sunken Vault]]) |
| 3  | "An explorer friend of mine just returned from the Faron Grasslands near the Dracozu River, and told me that he found the remains of an ancient spring. There was a statue there glowing with magic, but he was too afraid to touch it." ([[3. Spring of Courage]]) |
| 4  | "The seaside village of Lurelin is well known for its open-air fish market and it's dock with boat rentals available. Rumor is that some villagers there know how to trawl gold from the ocean floor." (Fishing For Riches [[Lurelin Village]]) |
| 5  | "Supposedly there's a magical island way out in the eastern ocean. I've never found anyone who knows exactly how to get there, but Lurelin Village would be the closest place to get there." ([[Eventide Island]]) |
| 6  | "Rumor is that the lake where Divine Beast Vah Ruta once stood is now almost entirely drained. One of my Zora friends says that his people are concerned." ([[4. Reflecting Pool Dungeon]]) |
^faron-random-rumor

### Random Encounters (15+)

Most of the Faron Region is wilderness, beach, or water, in which monsters are common.

|  d12  | Wilderness Encounter                               |
|:-----:|:-------------------------------------------------- |
|   1   | `encounter: 1: Yiga Footsoldier`                   |
|  2-3  | `encounter: 1d4: Blue Bokoblin, 1: Black Bokoblin` |
|  4-5  | `encounter: 1d8: ChuChu` (Blue and Yellow)         |
|  6-7  | `encounter: 1d3: Black Lizalfos` (Lightning)       |
|  8-9  | `encounter: 1d3: Blue Moblin`                      |
| 10-12 | `encounter: 1: Wizzrobe` (Lightning)               |
^faron-random-wilderness

|  d12  | Water Encounter                                                  |
|:-----:|:---------------------------------------------------------------- |
|  1-3  | `encounter: 1: Blue Moblin, 1d6: ChuChu` (Yellow, on a platform) |
|  4-6  | `encounter: 1d3: Octorok`                                        |
|  7-9  | `encounter: 1d6: Tektite`                                        |
| 10-12 | `encounter: 1d4: Black Lizalfos` (Lightning)                     |
^faron-random-water
