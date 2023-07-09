#location [[Underground]]

This area is locked behind the Amber Relic Door and is located primarily underneath the Akkala and Eldin regions.

### Locations



### Adventures
```dataview
table without id file.link as Name, Location, Reward, Type
from #adventure
where contains(Location, this.file.link) or contains(Location, this.file.name) or contains(Location_General, this.file.link) or contains(Location_General, this.file.name)
sort Type, Location, file.name
```
