#location #tower [[Central Research Base]]

Used solely for research and scientific observation of the area - no military uses.

Primary-Purpose:: Research
Region:: Central

### Characters
```dataview
table without id file.link as Name, Race, Gender, Age, Occupation, Comments
from #npc
where contains(Location, this.file.name)
sort Type, Occupation, file.name
```
