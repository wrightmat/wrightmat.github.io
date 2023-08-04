#location #stable [[Hebra Region]]

The primary animal tended here is the goat, who love the abundant grasses and Tabantha Wheat of the area.

A poster on an inside wall depicts the notes to the "Song of Storms" (see [[1. Central Windvane and Warp Songs]]).

Primary-Purpose:: Goats
Region:: Hebra

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
