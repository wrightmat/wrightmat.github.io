#location #stable [[Eldin Region]]

The primary animal tended here is the donkey, which travelers often buy or rent in order to explore the wilder areas of Eldin such as Death Mountain and Great Hyrule Forest.

A poster on an inside wall depicts the notes to "Saria's Song" (see [[1. Central Windvane and Warp Songs]]).

Primary-Purpose:: Donkeys
Region:: Eldin

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
