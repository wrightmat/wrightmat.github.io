#location #city [[Eldin Canyon]]

The Home of the Gorons is a north east location in the Eldin region, next to a huge towering volcano that dominates the skyline, causing extreme temperatures. A winding road leading from the entrance to Eldin from Trilby Valley paves the way to the settlement. The little town is built surrounding a pool of lava, which is crossed by bridges. The architecture is composed of stone shanties, inside which the Gorons live and conduct business.

>The Gorons have built their city near the pools of lava which surround Death Mountain. The Gorons run businesses inside of stone buildings, but there are no residences in site. The road passing through Goron City continues to the north toward an old mine, then onward to Death Mountain. A statue of rocks in the likeness of a giant Goron overlook the city.

### Locations

- Southern Mine
- North Mine and Quarry
- Ripped and Shredded, an armor shop
	- Flamebreaker Boots (700 rupees)
	- Flamebreaker Armor (600 rupees)
	- Flamebreaker Helm (2,000 rupees)
- Goron Gusto Shop, a general store
	- Rock Salt (12 rupees)
	- Fire Arrow (20 rupees)
	- Ice Arrow (20 rupees)
	- Goron Spice (16 rupees)
	- Cane Sugar (12 rupees)
	- Fireproof elixir (60 rupees)
	- Boulder Breaker
- Protein Palace, a food merchant and cooking location
	- Roasted Bass (23 rupees)
	- Seared Steak (30 rupees)
	- Toasty Hylian Shroom (12 rupees)
- Rollin' Inn
	- Regular bed (20 rupees)
	- Massage (80 rupees): grants (3) temporary hearts and (1) temporary stamina/magic

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
