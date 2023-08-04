#location #village [[Gerudo Region]]

The Kara Kara Bazaar is a small oasis in the Gerudo Desert, found on the path to Gerudo Town near the entry to the desert. It is a resting stop while exploring the hot Gerudo Desert, which has expanded considerably since the Calamity and Upheaval. In addition to the original building housing the Inn, adobe residences now dot the southeastern edge of the path to the bazaar's lake (east of the main building), and additional wooden stalls have been built along the northwestern edge of the path (east of the main building as well). A Great Fairy Fountain is also now located very near the Bazaar, at the entrance to the desert in the northeast.

A stela that's been erected near the main building depicts the notes to the "Requiem of Spirit" (see [[1. Central Windvane and Warp Songs]]).

### Locations

 - Kara Kara Bazaar Inn
 - Boraa's Bazaar Bank
 - Piaffe's Stable
 - Canolo Construction
 - Bozai's Rug Shop
 - Fashion Passion
	- Desert Voe Headband (450 rupees)
	- Desert Voe Spaulder (1,300 rupees)
	- Desert Voe Trousers (650 rupees)
 - General Store
	 - Electric Safflina (15 rp)
	 - Hydromelon (20 rp)
	 - Arrows (20 rp)
 - Maike's Meats and Monster Parts
	 - Roasted Bass (20 rp)
	 - Seared Steak (30 rp)
	 - Monster Tails (80 rp)
 - Robsten's Rich Spices
	 - Goron Spice
	 - Rock Salt

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
