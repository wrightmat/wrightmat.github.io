#location #tower [[Lanayru Great Spring]]

Small military outpost stationed to protect the Lanayru region.

Primary-Purpose:: Military
Region:: Lanayru

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
