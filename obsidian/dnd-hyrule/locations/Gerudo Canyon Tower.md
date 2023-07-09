#location #tower [[Gerudo Highlands]]

Small military outpost stationed to protect the Gerudo region.

Primary-Purpose:: Military
Region:: Gerudo

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
