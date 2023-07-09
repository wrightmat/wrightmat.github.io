#location #village [[Faron Grasslands]]

Lurelin is a seaside village located on the coast bordering the Faron and Necluda provinces, dotted with tropical palm trees and surrounded by steep cliffs that overshadow it.

>You crest a hill and discover a coastal village dotted with topical palm trees and surrounded by steep cliffs that overshadow it. The architecture consists of simple wooden huts, many of which are surrounded by palms in order to protect them from the occasional tropical storms that beset the area. The inhabitants of this village are Hylians with dark skin, many of whom make a living as humble fishermen. Seagulls fly in the skies over the village and the local fisherman have learned to use their tendency of flocking over certain places as an indicator of where to find fish and, in rare cases, sunken treasure. You can make out in the distance what appears to be an open-air fish market, as well as a boat rental dock, a small inn, and a large ship in the bay.

### Locations

- Open-air Fish Market
	- Porgy (40 rupees)
	- Crab (32 rupees)
	- Shock Arrow x10 (140 rupees)
	- Arrow x5 (20 rupees)
- Azure Bay, a restaurant
	- Seafood Paella
	- Seafood Fried Rice
	- Seafood Curry
- Inn and Salt Spa
	- Regular bed (20 rupees)
	- Salt spa bed (40 rupees): grants (1) temporary heart
- Lucky Treasure Shop
- Dock, with boat rentals
	- Rental, rowboat (500 rupees)
- Rozel's Resort Ship
	- Regular bed (30 rupees)
	- Soft bed (50 rupees): grants (1) temporary heart

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
