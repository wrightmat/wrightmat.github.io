#location #stable [[Faron Grasslands]]

The primary animal tended here is dondons, the large oxen-like animal that Princess Zelda discovered almost fifty years ago. A bridge has been built from the stable to the large pen across the Floria River.

Primary-Purpose:: Dondons
Region:: Faron

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
