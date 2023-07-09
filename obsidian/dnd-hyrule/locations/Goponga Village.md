#location #village [[Lanayru Wetlands]]

King Sidon took the declaration by King Link of the Zora as the protectors of the waterways of the kingdom as a mandate to expand out from Zora's domain, protecting additional waters downstream from monster attacks. The small settlement of Goponga Village was established on the ancient ruins in the center of the Lanayru Wetlands, a place where Hylians and Zora cohabitate peacefully. Sidon's father, Dorephan, volunteered to serve as village elder, which gave him something productive to do in his retirement years.

### Locations

* Goponga Island: primary commercial hub
	* Goponga General Store: located in the center of Goponga Island, which serves as the primary commercial hub.
	* Boné Blacksmith: blacksmith shop run by Fronk.
	* Moza's Monster Café: a restaurant that specializes in Monster Stew and other monster-based foods.
* Mercay Island
	* Mercay Tavern: situated basically on the outskirts of town, this tavern serves as a place for village residents to unwind.
	* Forest Village: the more rundown residential district for lower-class residents, and mix of Zora and Hylians.
* Molida Island
	* Molida Inn: the only building on Molida Island, where visitors can stay the night between the residential and commercial districts.
* Kincean Island
	* Kincean Creek: one of the primary residential areas, located on the northernmost island, where more Zora tend to live.
* Zauz Island
	* Zauz Springs: one of the primary residential areas, located on the westernmost island, where more Hylians tend to live.
* Bannan Island
	* Bannan Cannons: located on Bannan island. https://zelda.fandom.com/wiki/Cannon_Minigame
* Shrine Island: town hall building where the village elder resides and the business of the village is conducted.
* Wes Island: single rich person mansion where Lawdon resides.

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
