#location #town [[East Necluda]]

Found in the fairly peaceful region far to the east of Central Hyrule, Hateno was largely untouched by the Calamity and the Upheaval, and serves as one of the main Hylian towns. Hateno has grown quite a bit in the last few decades, expanding westward into the space between the town and Fort Hateno proper, which now serves as more of an entry gate. This space in between is primarily farm fields, with some houses thrown in - and is known as the pasture and granary. The older businesses remain in their same locations, and a few new businesses have been added - such as Karson's carpentry shop and the Zephyr Tavern.

>This is the town of greenery and dyes, Hateno Town. Nearby Fort Hateno, mostly still standing from ancient times, keeps the residents safe. While the school house and the Ancient Tech Lab on the hill keep their minds sharp.

### Locations

* [[Hateno Research Lab]]
- Fort Hateno
- Hateno Cemetery
	- Location just west of Robred Dropoff, where a group of small statues exist. A new mausoleum has been build into the cliff face.
- Hateno Pasture
	- The existing pasture remains and has expanded, now being famous kingdom-wide for its cheese.
- Hateno Fields and Granary
	- The area bordered by Lake Jarrah, Fir River, and Camphor Pond has been flooded so it can be used to grow rice. Ginner and Midla Woods now serve as a large orchard. The remaining Ovli Plain area is now fields where a variety of crops are grown.
- Hateno School House
	- The school house has more than quadrupled in size since it was started, and it now houses four classrooms, as well as a kitchen, study space, and office for the teachers and principal. 
	- On the wall is a poster with a musical scale and instructions on how to read music, as well as an ocarina and how to play particular notes. The notes depicted in the example are to the "Sun's Song" (see [[1. Central Windvane and Warp Songs]])
- East Wind, a general store
	- Heart Potion (20 rupees)
	- Revitalizing Potion (50 rupees)
	- Air Elixir (200 rupees)
	- Electro Elixir (100 rupees)
- Ventest Clothing Boutique, an armor shop and tailor
	- "Welcome! Welcome! Everyday clothes? Armor for soldiers? We have it all at Ventest Clothing!"
- Gust Guard Weapons
	- A new weapons shop that was opened by Nebb, who's been a "connoisseur" of weapons since he was a child.
- The Great Ton Pu Inn
	- Regular bed (20 rupees)
	- Soft bed (40 rupees): grants (1) temporary heart
- Kochi Dye Shop
	- "We live to dye!"
	- Dying of any clothing for 20 rupees
- Karson Carpentry
- Zephyr Tavern
- Harvest Bounty Restaurant

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
