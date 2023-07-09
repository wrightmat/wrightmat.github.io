#location #tower [[Hyrule Field]]

Small military outpost outside of Windvane Village that keeps an eye on Central Hyrule.

Primary-Purpose:: Military
Region:: Central

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
