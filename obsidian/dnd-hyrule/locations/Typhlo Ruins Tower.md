#location #tower [[Eldin Mountains]]

A larger military base, with regular rotation of soldiers from Akkala Citadel, that protects the Eldin Region.

Primary-Purpose:: Military
Region:: Eldin

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
