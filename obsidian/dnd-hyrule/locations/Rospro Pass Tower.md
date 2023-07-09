#location #tower [[Hebra Mountains]]

Small military outpost stationed to protect the Hebra region.

Primary-Purpose:: Military
Region:: Hebra

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
