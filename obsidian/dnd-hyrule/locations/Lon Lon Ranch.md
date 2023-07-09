#location [[Hyrule Field]]

Located at what was once known as Ranch Ruins, the ancient Lon Lon Ranch has rebuilt, and serves as the primary ranch and horse stables for all of Central Hyrule. The primary animal is cows, and the ranch supplies milk to communities throughout Hyrule (including the nearby village of Windvane). The primary structures are Marryn and Gaira's house, smaller house for guests or the ranch hand, a large barn for the cows and horses, a cuccoo house, several small dog houses, and a large racetrack for the horses with a smaller track for dogs inside of it. Several large farm fields and orchards are also present in the fields and forests east of the ranch, but many of these are tended by traveling farmers or professionals from Hyrule Castle Town or Windvane Village. Gaira tends most of the orchard trees though, and Fado does tend a few fields to get food for those who live in the ranch.

### Locations

* Marryn and Gaira's House
* Guest House
* Barn (Cows and Horses)
* Cuccoo House
* Dog Houses
* Racetrack (Horses and Dogs)
* Fields and Orchards

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
