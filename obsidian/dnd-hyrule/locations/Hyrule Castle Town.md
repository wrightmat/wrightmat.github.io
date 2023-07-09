#location #town [[Central Region]]

![https://i.redd.it/yof0s9j6dkd41.png|800](https://i.redd.it/yof0s9j6dkd41.png)

Castle Town is the capital of Hyrule located directly in front of Hyrule Castle. It is the main hub and center of activity in the Kingdom where Hyruleans come to engage in business and trade goods. The Town is considered to be one of the liveliest places in Hyrule. The population consists mostly of Hylians, but many other races travel there in order to do business.

During the Great Calamity, Hyrule Castle Town was completely destroyed, and the Castle itself was overtaken by Ganon and his Malice. After Ganon was destroyed, the Malice was removed and the town was slowly rebuilt. Then when the Upheaval hit, the Sacred Grounds ruins outside of town were used as a base to keep an eye on Hyrule Castle, and many of the research staff remained behind and created a permanent base.

Hyrule Castle Town is situated almost exactly in the center of the kingdom - north of the Great Plateau, south of the Korok Forest, east of the Tabantha Frontier, and west of the Lanayru Wetlands.

### Locations

* [[Hyrule Castle]]
* Town Hall: just south of the Castle, serving as a sort of administrative gate
* Central Square (south, merchant district)
	* Tailor's Shop
	* Castle Town Café and Inn
	* Castle Town Tavern
	* General Store
	* Spice Trader
	* Bomb Shop
	* Healer and Potion Shop
	* Central Square Fountain
* Forest Park (east, cultural district)
	* Library
	* Museum
	* Cathedral
	* School
	* University
* Castle Town Prison (west)
* Residential Districts
	* Crenel Hills: The richest folks live in this eastern, secluded, island-like area.
	* Cathedral Square: Upper-middle class subdivision between East Castle Town and the Forest Park cultural district.
	* East Castle Town: Middle-class residences.
	* West Castle Town: Lower-class residences.
	* Quarry Ruins: Slums.
* South Road: Leads directly to the Research Base and then branches out to various Hyrule Field roads.
* East Road: Branches north to Cathedral Square and then Forest Park, and continues east to Crenel Hills and on to Trilby Plain.
* West Road: Branches north to Castle Town Prison and south to Quarry Ruins and on to the Breach of Demise.

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
