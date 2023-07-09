#location #village [[Hebra Region]]

Rito Village is a collection of platforms, stairs, and huts that sit atop the largest island plateau in Lake Totori, and serves as the home of the birdlike Rito race. The village itself has a fair climate, though it gets colder should one climb up the mountain spire beyond the village platforms.

### Locations

- Slippery Falcon, a general store
- Brazen Beak, an armor shop and leatherworker
- Swallow's Roost
	- Hammock (20 rupees)
- Aerie Eats, a restaurant

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
