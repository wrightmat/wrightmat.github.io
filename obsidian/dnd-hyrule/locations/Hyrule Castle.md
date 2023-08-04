#location #castle/fort [[Central Region]]

![https://static0.gamerantimages.com/wordpress/wp-content/uploads/2020/12/breath-of-the-wild-mod-renovates-hyrule-castle.jpg?q=50&fit=contain&w=1140&h=&dpr=1.5|800](https://static0.gamerantimages.com/wordpress/wp-content/uploads/2020/12/breath-of-the-wild-mod-renovates-hyrule-castle.jpg?q=50&fit=contain&w=1140&h=&dpr=1.5)

At the far north end of Castle Town is the castle itself. A large drawbridge over a wide river leads to the castle's gaping entrance. Guards are stationed outside and throughout the castle, demonstrating that the castle is no place to mess around, while also feeling welcoming. Princess Zelda and King Link are the only full-time residents of the Castle, along with the guards who protect them, and the staff who serve them.

### Locations

* [[Hyrule Castle Town]]
* Castle Gates
* Observation Room
* First Gatehouse
* Guards' Chamber
* West Passage
* Second Gatehouse
* East Passage
* Dining Hall
* Zelda's Room and Study
* Sanctum (Throne Room)
* Library
* King's Room and Armory
* Docks

![https://i.imgur.com/QuB1Ns0.jpeg](https://i.imgur.com/QuB1Ns0.jpeg)

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where Location = this.file.name
sort Type, Occupation, file.name
```

### Adventures
```dataview
table without id file.link as Name, Location, Reward
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.link)
sort Type, Location, file.name
```
