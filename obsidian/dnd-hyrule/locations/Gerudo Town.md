#location #town [[Gerudo Town]]

Gerudo Town is the main settlement of the Gerudo Desert and consequently the Gerudo people. Only women are allowed to enter the Town. The northern portion of the city houses the throne room, with the chief's barracks to the northeast and the chief's Sand Seal stables to the northwest, and the remainder of the town is mostly shops and residences.

Gerudo Town has rebuilt after the recent attack from the Gibdos and their Queen, but the entire ordeal has made Riju a bit nervous. She has decided to keep the Gerudo Shelter under the city open for emergency purposes, and has relocated much of the Gerudo guard to protect the area and train there.

In order to protect the ancient holy site, Riju used her abilities to immediately return the Lightning Temple to its previous home under the sands. Little do others know that Riju commissioned a special new tunnel to be built from the end of the Gerudo Shelter under the throne room (behind a hidden door) all the way to the Lightning Temple's access, should it ever be needed in the future.

### Locations

- Royal Palace
- Sand-Seal Rental Shops
	- Southeast
	- Northwest
- Gerudo School House (former Gerudo Shelter)
- The Noble Canteen, a tavern
	- Noble Pursuit (20 rp)
- Starlight Memories Jewelry Shop
	- Diamond Circlet (1500 rupees)
	- Ruby Circlet (500 rupees)
	- Sapphire Circlet (800 rupees)
	- Topaz Earrings (500 rupees)
	- Opal Earrings (200 rupees)
	- Amber Earrings (100 rupees)
- Secret Club, a rare materials/clothing shop
	- Radiant Mask (800 rupees)
	- Radiant Shirt (800 rupees)
	- Radiant Tights (800 rupees)
	- Desert Voe Headband (450 rupees)
	- Desert Voe Spaulder (1,300 rupees)
	- Desert Voe Trousers (650 rupees)
- Hotel Oasis
	- Regular bed (20 rupees)
	- Spa service (80 rupees): grants (3) temporary hearts and (1) temporary stamina/magic
- General Store- Fruit Stand
	- Voltfruit (16 rupees)
	- Hydromelon (16 rupees)
	- Hearty Durian (60 rupees)
- General Store- Cooking Ingredients
	- Hylian Grains
	- ???
- General Store- Meat
- General Store- Mushrooms
- General Store- Weapons
	- Arrow x5 (20 rupees)
	- Red Monster Jelly (16 rp)
	- White Monster Jelly (16 rp)
	- Yellow Monster Jelly (16 rp)
	- Bomb Flowers (40 rp)
* Northern Ice House

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
