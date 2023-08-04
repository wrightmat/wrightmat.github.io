#location #town [[Lanayru Great Spring]]

The home of the Zoras is a peaceful architectural marvel beset between the mountains and rivers of Lanayru. A sacred location known as The Reflecting Pool, where Divine Beast Vah Ruta once stood, has become a source of concern for the Zora people, who have observed an evil eminence.

A relief carved at the entrance of the Luminous Graveyard depicts the notes to the "Serenade of Water" (see [[1. Central Windvane and Warp Songs]]).

### Locations

- Luminous Graveyard
- Zora Stone Monuments
- Marot's Mart, a general store
	- Heart Potion (20 rupees)
	- Air Elixir (200 rupees)
	- Electro Elixir (100 rupees)
- The Hammerhead, a blacksmith
- Seabed Inn
	- Regular bed (20 rupees)
	- Blissful waterbed (80 rupees): grants (3) temporary hearts and (1) temporary stamina/magic

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
