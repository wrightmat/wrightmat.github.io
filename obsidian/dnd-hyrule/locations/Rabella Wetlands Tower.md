#location #tower [[East Necluda]]

Small military outpost stationed to protect the Faron and Necluda regions.

Primary-Purpose:: Military
Region:: Necluda

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
