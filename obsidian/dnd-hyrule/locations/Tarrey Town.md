#location #town [[Akkala Region]]

Tarrey Town is the largest town in the Akkala Region and serves as corporate headquarters of the Hudson Construction company. The town is basically run by the company, and the large residential district houses all of the employees in a very suburban way.

### Locations

- Hudson Construction Headquarters
- Ore and More, a jewelry and gem shop
- Slippery Falcon (Tarrey Town Branch), a general store and weapon shop
- Residential District

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
